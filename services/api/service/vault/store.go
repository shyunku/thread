package vault

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"github.com/go-sql-driver/mysql"
	"strings"
)

var ErrConflict = errors.New("MEMBERSHIP_CONFLICT")
var ErrForbidden = errors.New("DEVICE_APPROVAL_FORBIDDEN")
var ErrNotFound = errors.New("VAULT_NOT_FOUND")
var ErrRotationRequired = errors.New("KEY_ROTATION_REQUIRED")

type Store struct{ DB *sql.DB }
type Head struct {
	VaultID  string `json:"vaultId"`
	Revision uint64 `json:"revision"`
	Digest   string `json:"digest"`
}

func validAccount(uid string) bool {
	return len(uid) > 0 && len(uid) <= 255 && strings.TrimSpace(uid) == uid && uid != "__thread_env_admin__"
}

type Page struct {
	Head    Head     `json:"head"`
	Genesis []byte   `json:"genesis"`
	Records [][]byte `json:"records"`
	Next    uint64   `json:"next"`
	More    bool     `json:"more"`
}

// Read returns original signed bytes, not server-reconstructed membership data.
func (s *Store) Read(ctx context.Context, uid string, after uint64) (Page, error) {
	if !validAccount(uid) || after > MaxSafeInteger {
		return Page{}, ErrForbidden
	}
	tx, e := s.DB.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	if e != nil {
		return Page{}, e
	}
	defer tx.Rollback()
	var p Page
	var head []byte
	e = tx.QueryRowContext(ctx, `SELECT vault_id,membership_revision,membership_head FROM vaults WHERE account_id=?`, uid).Scan(&p.Head.VaultID, &p.Head.Revision, &head)
	if e == sql.ErrNoRows {
		return Page{}, ErrNotFound
	}
	if e != nil {
		return Page{}, e
	}
	if after > p.Head.Revision {
		return Page{}, ErrConflict
	}
	p.Head.Digest = HeadString(head)
	p.Next = after
	p.Records = make([][]byte, 0)
	if e = tx.QueryRowContext(ctx, `SELECT signed_record FROM vault_membership_events WHERE vault_id=? AND revision=0`, p.Head.VaultID).Scan(&p.Genesis); e != nil {
		return Page{}, e
	}
	rows, e := tx.QueryContext(ctx, `SELECT revision,signed_record FROM vault_membership_events WHERE vault_id=? AND revision>? ORDER BY revision LIMIT 128`, p.Head.VaultID, after)
	if e != nil {
		return Page{}, e
	}
	size := 0
	for rows.Next() {
		var revision uint64
		var raw []byte
		if e = rows.Scan(&revision, &raw); e != nil {
			rows.Close()
			return Page{}, e
		}
		if size > 0 && size+len(raw) > 4*MaxBytes {
			break
		}
		size += len(raw)
		p.Records = append(p.Records, raw)
		p.Next = revision
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return Page{}, e
	}
	p.More = p.Next < p.Head.Revision
	return p, tx.Commit()
}
func conflict(err error) error {
	var me *mysql.MySQLError
	if errors.As(err, &me) && me.Number == 1062 {
		return ErrConflict
	}
	return err
}
func (s *Store) Create(ctx context.Context, uid string, raw []byte) (Head, error) {
	if !validAccount(uid) {
		return Head{}, ErrForbidden
	}
	g, e := ParseGenesis(raw)
	if e != nil {
		return Head{}, e
	}
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return Head{}, e
	}
	defer tx.Rollback()
	var exists int
	if e = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM user_master WHERE uid=?", uid).Scan(&exists); e != nil {
		return Head{}, e
	}
	if exists != 1 {
		return Head{}, ErrForbidden
	}
	_, e = tx.ExecContext(ctx, `INSERT INTO vaults(vault_id,account_id,epoch,suite,genesis_digest,membership_head,recovery_public_key) VALUES(?,?,'1',?,?,?,?)`, g.ID, uid, Suite, g.Digest, g.Digest, g.Recovery)
	if e != nil {
		return Head{}, conflict(e)
	}
	_, e = tx.ExecContext(ctx, `INSERT INTO vault_membership_events(vault_id,revision,event_digest,signed_record) VALUES(?,0,?,?)`, g.ID, g.Digest, g.Record.Raw)
	if e != nil {
		return Head{}, e
	}
	if e = insertDevice(ctx, tx, g.ID, 0, g.Owner); e != nil {
		return Head{}, e
	}
	return Head{g.ID, 0, HeadString(g.Digest)}, tx.Commit()
}
func insertDevice(ctx context.Context, tx *sql.Tx, id string, revision uint64, d Device) error {
	_, e := tx.ExecContext(ctx, `INSERT INTO vault_devices(vault_id,device_id,signing_public_key,encryption_public_key,role,can_authorize_devices,approved_revision) VALUES(?,?,?,?,?,?,?)`, id, d.ID, d.SigningKey, d.EncryptionKey, d.Role, d.Authorize, revision)
	return conflict(e)
}

// ApplyPending serializes membership edits for a pending vault only. Active
// revocation requires atomic key rotation and is deliberately not exposed here.
func (s *Store) ApplyPending(ctx context.Context, uid string, raw []byte) (Head, error) {
	if !validAccount(uid) {
		return Head{}, ErrForbidden
	}
	r, e := ParseRecord(raw)
	if e != nil {
		return Head{}, e
	}
	b := r.Body
	id, _ := b["vaultId"].(string)
	revision, ok := b["revision"].(uint64)
	previous, _ := b["previous"].(string)
	signer, _ := b["signer"].(string)
	operation, _ := b["operation"].(string)
	if !identifier.MatchString(id) || !ok || revision == 0 || revision > MaxSafeInteger || !identifier.MatchString(signer) || len(b) != 6 || (operation != "add" && operation != "revoke") {
		return Head{}, ErrInvalid
	}
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return Head{}, e
	}
	defer tx.Rollback()
	var current uint64
	var head []byte
	var mode string
	e = tx.QueryRowContext(ctx, `SELECT membership_revision,membership_head,mode FROM vaults WHERE vault_id=? AND account_id=? FOR UPDATE`, id, uid).Scan(&current, &head, &mode)
	if e == sql.ErrNoRows {
		return Head{}, ErrNotFound
	}
	if e != nil {
		return Head{}, e
	}
	if mode != "pending" {
		return Head{}, ErrRotationRequired
	}
	if revision <= current {
		var existing []byte
		if e = tx.QueryRowContext(ctx, `SELECT signed_record FROM vault_membership_events WHERE vault_id=? AND revision=?`, id, revision).Scan(&existing); e == nil && bytes.Equal(existing, raw) {
			return Head{id, current, HeadString(head)}, nil
		}
		return Head{}, ErrConflict
	}
	if revision != current+1 || previous != HeadString(head) {
		return Head{}, ErrConflict
	}
	var signing []byte
	var authorizer bool
	e = tx.QueryRowContext(ctx, `SELECT signing_public_key,can_authorize_devices FROM vault_devices WHERE vault_id=? AND device_id=? AND revoked_revision IS NULL`, id, signer).Scan(&signing, &authorizer)
	if e == sql.ErrNoRows || !authorizer {
		return Head{}, ErrForbidden
	}
	if e != nil {
		return Head{}, e
	}
	if e = r.Verify(signing, "membership"); e != nil {
		return Head{}, e
	}
	digest, e := Fingerprint(r.Value)
	if e != nil {
		return Head{}, e
	}
	_, e = tx.ExecContext(ctx, `INSERT INTO vault_membership_events(vault_id,revision,event_digest,previous_digest,signed_record) VALUES(?,?,?,?,?)`, id, revision, digest, head, raw)
	if e != nil {
		return Head{}, conflict(e)
	}
	if operation == "add" {
		d, e := ParseDevice(b["device"])
		if e != nil {
			return Head{}, e
		}
		if e = insertDevice(ctx, tx, id, revision, d); e != nil {
			return Head{}, e
		}
	} else {
		target, _ := b["deviceId"].(string)
		if !identifier.MatchString(target) {
			return Head{}, ErrInvalid
		}
		// Preserve at least one authorization path until recovery is integrated.
		var remaining int
		e = tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM vault_devices WHERE vault_id=? AND revoked_revision IS NULL AND can_authorize_devices=TRUE AND device_id<>?`, id, target).Scan(&remaining)
		if e != nil {
			return Head{}, e
		}
		if remaining == 0 {
			return Head{}, ErrForbidden
		}
		result, e := tx.ExecContext(ctx, `UPDATE vault_devices SET revoked_revision=? WHERE vault_id=? AND device_id=? AND revoked_revision IS NULL`, revision, id, target)
		if e != nil {
			return Head{}, e
		}
		n, e := result.RowsAffected()
		if e != nil {
			return Head{}, e
		}
		if n != 1 {
			return Head{}, ErrNotFound
		}
	}
	_, e = tx.ExecContext(ctx, `UPDATE vaults SET membership_revision=?,membership_head=? WHERE vault_id=?`, revision, digest, id)
	if e != nil {
		return Head{}, e
	}
	return Head{id, revision, HeadString(digest)}, tx.Commit()
}
