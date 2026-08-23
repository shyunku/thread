package state

import (
	"encoding/json"
	"github.com/jmoiron/sqlx"
	"memorial_app_server/log"
	"memorial_app_server/service/database"
)

var Chains *ChainCluster = nil

func InitializeService(db *sqlx.DB) error {
	Chains = NewChainCluster()
	if err := Chains.LoadFromDatabase(db); err != nil {
		return err
	}
	return nil
}

type ChainCluster map[string]*Chain

func NewChainCluster() *ChainCluster {
	return &ChainCluster{}
}

func (sm *ChainCluster) GetChain(userId string) *Chain {
	chain, ok := (*sm)[userId]
	if !ok {
		chain = newStateChain(userId)
		(*sm)[userId] = chain
	}
	return chain
}

func (sm *ChainCluster) LoadFromDatabase(db *sqlx.DB) error {
	// load transactions
	transactions := make(map[string]*Transaction)
	txRows, err := db.Queryx("SELECT * FROM transactions")
	if err != nil {
		return err
	}

	for txRows.Next() {
		var tx database.TransactionEntity
		if err := txRows.StructScan(&tx); err != nil {
			log.Errorf("failed to scan struct of transaction %v ", err)
			return err
		}

		var decodedContent interface{}
		if err := json.Unmarshal(tx.Content, &decodedContent); err != nil {
			return err
		}

		transactions[*tx.Hash] = NewTransaction(
			*tx.Version,
			*tx.From,
			*tx.Type,
			*tx.Timestamp,
			decodedContent,
			*tx.Hash,
		)
	}

	// load states
	blockEntities := make(map[int64]database.BlockEntity)
	blockRows, err := database.DB.Queryx("SELECT * FROM blocks ORDER BY block_number")
	if err != nil {
		return err
	}

	for blockRows.Next() {
		// insert blocks
		var block database.BlockEntity
		if err := blockRows.StructScan(&block); err != nil {
			log.Errorf("failed to scan struct of block %s: %v ", *block.BlockHash, err)
			return err
		}
		blockNumber := *block.Number
		blockEntities[blockNumber] = block
	}

	for blockNumber, block := range blockEntities {
		tx, ok := transactions[*block.TxHash]
		if !ok {
			log.Errorf("transaction not found for tx_hash %s: %v", *block.TxHash, err)
			return err
		}

		chain := sm.GetChain(tx.From)
		if _, ok := chain.Blocks[blockNumber]; ok {
			// no need to update
			continue
		}

		newState := NewState()
		if err := newState.FromBytes(block.State); err != nil {
			log.Errorf("failed to parse state of userId %s: %v", tx.From, err)
			return err
		}

		transitions := NewTransitions()
		if block.Transitions != nil {
			// handle only transition-applied blocks
			if err := transitions.FromBytes(block.Transitions); err != nil {
				log.Errorf("failed to parse transitions of userId %s: %v", tx.From, err)
				return err
			}
		}

		// find transaction
		tx, exists := transactions[*block.TxHash]
		if !exists {
			log.Errorf("transaction not found for tx_hash %s: %v", *block.TxHash, err)
			return err
		}

		var prevBlockHash string
		if block.PrevBlockHash == nil {
			log.Warnf("prev_block_hash is nil for block %s", *block.BlockHash)
			prevBlockHash = ""
		} else {
			prevBlockHash = *block.PrevBlockHash
			if err != nil {
				log.Errorf("failed to parse prev_block_hash of userId %s: %v", tx.From, err)
				return err
			}
		}

		updates := NewUpdatesWithTransitions(tx, transitions)
		newBlock := NewBlock(blockNumber, newState, updates, prevBlockHash)
		chain.InsertBlock(newBlock)
	}

	return nil
}
