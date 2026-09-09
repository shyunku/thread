// Package vault validates signed metadata without ever receiving data keys.
package vault

import (
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"github.com/fxamacker/cbor/v2"
	"reflect"
	"regexp"
)

const Suite = "thread-e2ee-v1"
const MaxBytes = 1048576
const MaxSafeInteger = uint64(9007199254740991)

var ErrInvalid = errors.New("INVALID_SIGNED_RECORD")
var enc = cborCanonical()
var dec = cborDecoder()
var identifier = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)

func cborCanonical() cbor.EncMode {
	m, e := cbor.CanonicalEncOptions().EncMode()
	if e != nil {
		panic(e)
	}
	return m
}
func cborDecoder() cbor.DecMode {
	m, e := (cbor.DecOptions{DupMapKey: cbor.DupMapKeyEnforcedAPF,
		MaxNestedLevels: 24, MaxArrayElements: 65536, MaxMapPairs: 65536, IndefLength: cbor.IndefLengthForbidden,
		TagsMd: cbor.TagsForbidden, DefaultMapType: reflect.TypeOf(map[string]interface{}{})}).DecMode()
	if e != nil {
		panic(e)
	}
	return m
}
func validValue(v interface{}, depth int) bool {
	if depth > 24 {
		return false
	}
	switch x := v.(type) {
	case nil, bool, []byte, string:
		return true
	case uint64:
		return x <= MaxSafeInteger
	case int64:
		return x >= -int64(MaxSafeInteger) && x <= int64(MaxSafeInteger)
	case []interface{}:
		for _, y := range x {
			if !validValue(y, depth+1) {
				return false
			}
		}
		return true
	case map[string]interface{}:
		for k, y := range x {
			if k == "__proto__" || k == "constructor" || k == "prototype" || !validValue(y, depth+1) {
				return false
			}
		}
		return true
	default:
		return false
	}
}
func Encode(v interface{}) ([]byte, error) {
	if !validValue(v, 0) {
		return nil, ErrInvalid
	}
	b, e := enc.Marshal(v)
	if e != nil || len(b) > MaxBytes {
		return nil, ErrInvalid
	}
	return b, nil
}
func Decode(b []byte) (interface{}, error) {
	if len(b) == 0 || len(b) > MaxBytes {
		return nil, ErrInvalid
	}
	var v interface{}
	if e := dec.Unmarshal(b, &v); e != nil {
		return nil, ErrInvalid
	}
	canonical, e := Encode(v)
	if e != nil || !bytes.Equal(canonical, b) {
		return nil, ErrInvalid
	}
	return v, nil
}
func Fingerprint(v interface{}) ([]byte, error) {
	b, e := Encode([]interface{}{Suite, "genesis", v})
	if e != nil {
		return nil, e
	}
	h := sha256.Sum256(b)
	return h[:], nil
}

type Record struct {
	Body      map[string]interface{}
	Signature []byte
	Raw       []byte
	Value     map[string]interface{}
}

func ParseRecord(raw []byte) (Record, error) {
	value, e := Decode(raw)
	if e != nil {
		return Record{}, e
	}
	v, ok := value.(map[string]interface{})
	if !ok || len(v) != 2 {
		return Record{}, ErrInvalid
	}
	body, ok := v["body"].(map[string]interface{})
	if !ok {
		return Record{}, ErrInvalid
	}
	sig, ok := v["signature"].([]byte)
	if !ok || len(sig) != ed25519.SignatureSize {
		return Record{}, ErrInvalid
	}
	return Record{body, sig, append([]byte(nil), raw...), v}, nil
}
func (r Record) Verify(key []byte, purpose string) error {
	b, e := Encode([]interface{}{Suite, purpose, r.Body})
	if e != nil || len(key) != ed25519.PublicKeySize || !ed25519.Verify(key, b, r.Signature) {
		return ErrInvalid
	}
	return nil
}

type Device struct {
	ID, Role                  string
	Authorize                 bool
	SigningKey, EncryptionKey []byte
}

func ParseDevice(value interface{}) (Device, error) {
	m, ok := value.(map[string]interface{})
	if !ok || len(m) != 5 {
		return Device{}, ErrInvalid
	}
	id, _ := m["id"].(string)
	role, _ := m["role"].(string)
	auth, ok := m["canAuthorizeDevices"].(bool)
	signing, _ := m["signingKey"].([]byte)
	encryption, _ := m["encryptionKey"].([]byte)
	if !identifier.MatchString(id) || (role != "read" && role != "write") || !ok || len(signing) != 32 || len(encryption) != 32 {
		return Device{}, ErrInvalid
	}
	return Device{id, role, auth, signing, encryption}, nil
}

type Genesis struct {
	ID               string
	Owner            Device
	Recovery, Digest []byte
	Record           Record
}

func ParseGenesis(raw []byte) (Genesis, error) {
	r, e := ParseRecord(raw)
	if e != nil {
		return Genesis{}, e
	}
	b := r.Body
	schema, _ := b["schema"].(uint64)
	id, _ := b["vaultId"].(string)
	recovery, _ := b["recoveryKey"].([]byte)
	owner, e := ParseDevice(b["owner"])
	if e != nil || len(b) != 4 || schema != 1 || !identifier.MatchString(id) || len(recovery) != 32 || owner.Role != "write" || !owner.Authorize {
		return Genesis{}, ErrInvalid
	}
	if e = r.Verify(owner.SigningKey, "genesis"); e != nil {
		return Genesis{}, e
	}
	digest, e := Fingerprint(b)
	return Genesis{id, owner, recovery, digest, r}, e
}
func HeadString(head []byte) string { return hex.EncodeToString(head) }
