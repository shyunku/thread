package state

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"github.com/goccy/go-json"
)

var (
	ErrInvalidTxType = errors.New("invalid transaction type")
	ErrInvalidTxFrom = errors.New("invalid transaction from")
	ErrInvalidTxTime = errors.New("invalid transaction time")
	ErrStateMismatch = errors.New("state mismatch")

	SchemeVersion = 0
)

type Hash [32]byte

func (h Hash) Bytes() []byte {
	return h[:]
}

func (h Hash) Hex() string {
	return hex.EncodeToString(h[:])
}

func hexToHash(str string) (Hash, error) {
	// convert hex string to byte array
	bytes, err := hex.DecodeString(str)
	if err != nil {
		return Hash{}, err
	}
	// convert byte array to hash
	var hash Hash
	copy(hash[:], bytes)
	return hash, nil
}

type rawTransaction struct {
	Version   int         `json:"version"`
	Type      int64       `json:"type"`
	Timestamp int64       `json:"timestamp"`
	Content   interface{} `json:"content"`
}

type Transaction struct {
	Version   int         `json:"version"`
	From      string      `json:"from"`
	Type      int64       `json:"type"`
	Timestamp int64       `json:"timestamp"`
	Content   interface{} `json:"content"`
	Hash      string      `json:"hash"`
}

func NewTransaction(version int, from string, txType int64, timestamp int64, content interface{}, hash string) *Transaction {
	tx := &Transaction{
		Version:   version,
		From:      from,
		Type:      txType,
		Timestamp: timestamp,
		Content:   content,
		Hash:      hash,
	}
	//tx.Hash = tx.CalcHash().Hex()
	return tx
}

func (tx *Transaction) CalcHash() Hash {
	rawTransaction := rawTransaction{
		Version:   tx.Version,
		Type:      tx.Type,
		Timestamp: tx.Timestamp,
		Content:   tx.Content,
	}
	buffer := new(bytes.Buffer)
	encoder := json.NewEncoder(buffer)
	encoder.SetEscapeHTML(false)
	_ = encoder.Encode(rawTransaction)

	jsonBytes := buffer.Bytes()
	jsonBytes = bytes.TrimRight(jsonBytes, "\n")
	//log.Debugf("Transaction hash: %v", jsonBytes)
	hash := sha256.Sum256(jsonBytes)
	return hash
}

func (tx *Transaction) Validate() error {
	// from validation
	if tx.From == "" {
		return ErrInvalidTxFrom
	}
	// timestamp validation
	if tx.Timestamp < 0 {
		return ErrInvalidTxTime
	}
	return nil
}
