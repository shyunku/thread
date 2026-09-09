package vault

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"errors"
	"strconv"
)

var ErrInactive = errors.New("E2EE_NOT_ACTIVE")
var ErrObjectConflict = errors.New("OBJECT_CONFLICT")
var ErrQuota = errors.New("SNAPSHOT_LIMIT")

type PushResult struct {
	Seq      string            `json:"seq"`
	Versions map[string]string `json:"versions"`
}
type operation struct {
	ID      string
	Base    uint64
	Deleted bool
}

func decimal(v interface{}, positive bool) (uint64, bool) {
	s, ok := v.(string)
	if !ok || len(s) > 20 {
		return 0, false
	}
	n, e := strconv.ParseUint(s, 10, 64)
	return n, e == nil && strconv.FormatUint(n, 10) == s && (!positive || n > 0)
}
func parseOperations(v interface{}) ([]operation, error) {
	list, ok := v.([]interface{})
	if !ok || len(list) == 0 || len(list) > 100 {
		return nil, ErrInvalid
	}
	result := make([]operation, 0, len(list))
	seen := map[string]bool{}
	for _, v := range list {
		b, ok := v.(map[string]interface{})
		if !ok || len(b) != 4 {
			return nil, ErrInvalid
		}
		id, _ := b["objectId"].(string)
		base, bok := decimal(b["baseVersion"], false)
		deleted, dok := b["deleted"].(bool)
		fields, fok := b["fields"].([]interface{})
		if !identifier.MatchString(id) || seen[id] || !bok || base == ^uint64(0) || !dok || !fok || len(fields) > 256 || (deleted && len(fields) != 0) || (!deleted && len(fields) == 0) {
			return nil, ErrInvalid
		}
		seen[id] = true
		slots := map[uint64]bool{}
		for _, f := range fields {
			field, ok := f.(map[string]interface{})
			if !ok || len(field) != 3 {
				return nil, ErrInvalid
			}
			slot, sok := field["slot"].(uint64)
			nonce, _ := field["nonce"].([]byte)
			ciphertext, _ := field["ciphertext"].([]byte)
			if !sok || slots[slot] || len(nonce) != 24 || len(ciphertext) < 16 {
				return nil, ErrInvalid
			}
			slots[slot] = true
		}
		result = append(result, operation{id, base, deleted})
	}
	return result, nil
}
func (s *Store) Push(ctx context.Context, uid string, raw []byte) (PushResult, error) {
	if !validAccount(uid) {
		return PushResult{}, ErrForbidden
	}
	r, e := ParseRecord(raw)
	if e != nil {
		return PushResult{}, e
	}
	b := r.Body
	id, _ := b["vaultId"].(string)
	device, _ := b["deviceId"].(string)
	epoch, _ := b["epoch"].(string)
	mutation, _ := b["mutationId"].(string)
	schema, _ := b["schema"].(uint64)
	revision, rok := b["membershipRevision"].(uint64)
	generation, gok := b["keyGeneration"].(uint64)
	counter, cok := decimal(b["counter"], true)
	ops, e := parseOperations(b["operations"])
	if e != nil || len(b) != 9 || schema != 1 || !identifier.MatchString(id) || !identifier.MatchString(device) || !identifier.MatchString(mutation) || !identifier.MatchString(epoch) || !rok || !gok || !cok {
		return PushResult{}, ErrInvalid
	}
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return PushResult{}, e
	}
	defer tx.Rollback()
	var mode, currentEpoch string
	var currentRevision, currentGeneration uint64
	e = tx.QueryRowContext(ctx, `SELECT mode,epoch,membership_revision,current_key_generation FROM vaults WHERE vault_id=? AND account_id=? FOR UPDATE`, id, uid).Scan(&mode, &currentEpoch, &currentRevision, &currentGeneration)
	if e == sql.ErrNoRows {
		return PushResult{}, ErrNotFound
	}
	if e != nil {
		return PushResult{}, e
	}
	if mode != "active" {
		return PushResult{}, ErrInactive
	}
	var signing []byte
	var role string
	var lastCounter uint64
	e = tx.QueryRowContext(ctx, `SELECT signing_public_key,role,last_counter FROM vault_devices WHERE vault_id=? AND device_id=? AND revoked_revision IS NULL`, id, device).Scan(&signing, &role, &lastCounter)
	if e == sql.ErrNoRows {
		return PushResult{}, ErrForbidden
	}
	if e != nil {
		return PushResult{}, e
	}
	if role != "write" {
		return PushResult{}, ErrForbidden
	}
	if e = r.Verify(signing, "mutation"); e != nil {
		return PushResult{}, e
	}
	digest := sha256.Sum256(raw)
	var priorDigest, priorResult []byte
	e = tx.QueryRowContext(ctx, `SELECT request_digest,result FROM encrypted_receipts WHERE vault_id=? AND device_id=? AND mutation_id=?`, id, device, mutation).Scan(&priorDigest, &priorResult)
	if e == nil {
		if !bytes.Equal(priorDigest, digest[:]) {
			return PushResult{}, ErrConflict
		}
		var result PushResult
		e = json.Unmarshal(priorResult, &result)
		return result, e
	}
	if e != sql.ErrNoRows {
		return PushResult{}, e
	}
	if epoch != currentEpoch || revision != currentRevision || generation != currentGeneration || counter <= lastCounter {
		return PushResult{}, ErrConflict
	}
	if _, e = tx.ExecContext(ctx, `INSERT IGNORE INTO vault_sync(vault_id) VALUES(?)`, id); e != nil {
		return PushResult{}, e
	}
	var seq uint64
	if e = tx.QueryRowContext(ctx, `SELECT last_seq FROM vault_sync WHERE vault_id=?`, id).Scan(&seq); e != nil {
		return PushResult{}, e
	}
	if seq == ^uint64(0) {
		return PushResult{}, ErrConflict
	}
	seq++
	result := PushResult{strconv.FormatUint(seq, 10), map[string]string{}}
	for index, op := range ops {
		var version uint64
		var deleted bool
		e = tx.QueryRowContext(ctx, `SELECT version,deleted FROM encrypted_objects WHERE vault_id=? AND object_id=?`, id, op.ID).Scan(&version, &deleted)
		if e != nil && e != sql.ErrNoRows {
			return PushResult{}, e
		}
		if version != op.Base || deleted || (version == 0 && op.Deleted) {
			return PushResult{}, ErrObjectConflict
		}
		_, e = tx.ExecContext(ctx, `INSERT INTO encrypted_objects(vault_id,object_id,version,seq,deleted,operation_index,signed_record) VALUES(?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE version=VALUES(version),seq=VALUES(seq),deleted=VALUES(deleted),operation_index=VALUES(operation_index),signed_record=VALUES(signed_record)`, id, op.ID, version+1, seq, op.Deleted, index, raw)
		if e != nil {
			return PushResult{}, e
		}
		result.Versions[op.ID] = strconv.FormatUint(version+1, 10)
	}
	encoded, e := json.Marshal(result)
	if e != nil {
		return PushResult{}, e
	}
	_, e = tx.ExecContext(ctx, `INSERT INTO encrypted_changes(vault_id,seq,signed_record,result) VALUES(?,?,?,?)`, id, seq, raw, encoded)
	if e != nil {
		return PushResult{}, e
	}
	_, e = tx.ExecContext(ctx, `INSERT INTO encrypted_receipts(vault_id,device_id,mutation_id,counter,request_digest,result) VALUES(?,?,?,?,?,?)`, id, device, mutation, counter, digest[:], encoded)
	if e != nil {
		return PushResult{}, conflict(e)
	}
	if _, e = tx.ExecContext(ctx, `UPDATE vault_devices SET last_counter=? WHERE vault_id=? AND device_id=?`, counter, id, device); e != nil {
		return PushResult{}, e
	}
	if _, e = tx.ExecContext(ctx, `UPDATE vault_sync SET last_seq=? WHERE vault_id=?`, seq, id); e != nil {
		return PushResult{}, e
	}
	return result, tx.Commit()
}
