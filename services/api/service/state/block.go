package state

import (
	"crypto/sha256"
	"encoding/json"
)

type rawBlock struct {
	Number        int64  `json:"number"`
	TxHash        string `json:"txHash"`
	PrevBlockHash string `json:"prevBlockHash"`
}

type Block struct {
	Number        int64 `json:"number"`
	State         *State
	Updates       *Updates `json:"updates"`
	PrevBlockHash string
	Hash          string `json:"hash"`
}

func NewBlock(number int64, state *State, updates *Updates, prevBlockHash string) *Block {
	b := &Block{
		Number:        number,
		State:         state,
		Updates:       updates,
		PrevBlockHash: prevBlockHash,
	}
	b.Hash = b.CalcHash().Hex()
	return b
}

func InitialBlock() *Block {
	return NewBlock(0, NewState(), nil, "")
}

func (b *Block) CalcHash() Hash {
	txHash := ""
	if b.Updates != nil {
		txHash = b.Updates.SrcTx.Hash
	}
	return ExpectedBlockHash(b.Number, txHash, b.PrevBlockHash)
}

func ExpectedBlockHash(number int64, txHash string, prevBlockHash string) Hash {
	rawBlock := rawBlock{
		Number:        number,
		TxHash:        txHash,
		PrevBlockHash: prevBlockHash,
	}
	bytes, _ := json.Marshal(rawBlock)
	//log.Testf("Block[%d] hash: %s", rawBlock.Number, bytes)
	hash := sha256.Sum256(bytes)
	return hash
}
