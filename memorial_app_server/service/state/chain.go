package state

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jmoiron/sqlx"
	"memorial_app_server/log"
	"memorial_app_server/service/database"
	"sync"
)

type Chain struct {
	UserId          string           `json:"user_id"`
	Blocks          map[int64]*Block `json:"blocks"`
	LastBlockNumber int64            `json:"last_block_number"`
	lock            *sync.Mutex
}

func newStateChain(userId string) *Chain {
	// TODO :: add cleaner as go-routine for database
	c := &Chain{
		UserId:          userId,
		Blocks:          make(map[int64]*Block),
		LastBlockNumber: 0,
		lock:            &sync.Mutex{},
	}
	newBlock := InitialBlock()
	c.Blocks[0] = newBlock
	log.Debugf("Initial block hash: %s", newBlock.Hash)
	return c
}

func (c *Chain) GetLastState() *State {
	return c.Blocks[c.LastBlockNumber].State
}

func (c *Chain) GetLastBlockNumber() int64 {
	return c.LastBlockNumber
}

func (c *Chain) GetWaitingBlockNumber() int64 {
	return c.LastBlockNumber + 1
}

func (c *Chain) GetBlockHash(number int64) (string, error) {
	block, err := c.GetBlockByNumber(number)
	if err != nil {
		return "", err
	}
	return block.Hash, nil
}

func (c *Chain) GetBlocksByInterval(start, end int64) ([]*Block, error) {
	var blocks []*Block
	for i := start; i <= end; i++ {
		block, err := c.GetBlockByNumber(i)
		if err != nil {
			return nil, err
		}
		blocks = append(blocks, block)
	}
	return blocks, nil
}

func (c *Chain) GetBlockByNumber(number int64) (*Block, error) {
	if number < 0 {
		return nil, fmt.Errorf("invalid block number: %d", number)
	}
	if number == 0 {
		return c.Blocks[0], nil
	}

	// find block on cache
	block, exist := c.Blocks[number]
	if !exist {
		// find block on database
		var blockEntity database.BlockEntity
		err := database.DB.Get(&blockEntity, "SELECT * FROM blocks WHERE uid = ? AND block_number = ?", c.UserId, number)
		if err != nil {
			log.Error(err)
			log.Debug("block number: ", number)
			return nil, err
		}

		state := NewState()
		if err = state.FromBytes(blockEntity.State); err != nil {
			log.Error(err)
			return nil, err
		}

		transitions := NewTransitions()
		if err = transitions.FromBytes(blockEntity.Transitions); err != nil {
			log.Error(err)
			return nil, err
		}

		var txEntity database.TransactionEntity
		err = database.DB.Get(&txEntity, "SELECT * FROM transactions WHERE `from` = ? AND hash = ?", c.UserId, blockEntity.TxHash)
		if err != nil {
			log.Error(err)
			return nil, err
		}

		// get previous blockHash
		prevBlockHash, err := c.GetBlockHash(number - 1)
		if err != nil {
			log.Error(err)
			return nil, err
		}

		tx := NewTransaction(*txEntity.Version, *txEntity.From, *txEntity.Type, *txEntity.Timestamp, txEntity.Content, *txEntity.Hash)
		updates := NewUpdatesWithTransitions(tx, transitions)
		block = NewBlock(number, state, updates, prevBlockHash)
		c.InsertBlock(block)
	}

	return block, nil
}

func (c *Chain) GetBlockByHash(hash Hash) (*Block, error) {
	// TODO :: optimize this (maybe use cache)
	var blockEntity database.BlockEntity
	err := database.DB.Get(&blockEntity, "SELECT * FROM blocks WHERE uid = ? AND block_hash = ?", c.UserId, hash)
	if err != nil {
		return nil, err
	}

	state := NewState()
	if err = state.FromBytes(blockEntity.State); err != nil {
		return nil, err
	}

	transitions := NewTransitions()
	if err = transitions.FromBytes(blockEntity.Transitions); err != nil {
		return nil, err
	}

	var txEntity database.TransactionEntity
	err = database.DB.Get(&txEntity, "SELECT * FROM transactions WHERE `from` = ? AND hash = ?", c.UserId, blockEntity.TxHash)
	if err != nil {
		return nil, err
	}

	prevBlockHash := *blockEntity.PrevBlockHash
	if err != nil {
		return nil, err
	}

	tx := NewTransaction(*txEntity.Version, *txEntity.From, *txEntity.Type, *txEntity.Timestamp, txEntity.Content, *txEntity.Hash)
	updates := NewUpdatesWithTransitions(tx, transitions)
	block := NewBlock(*blockEntity.Number, state, updates, prevBlockHash)

	return block, nil
}

func (c *Chain) DeleteBlockByInterval(start, end int64) error {
	c.lock.Lock()
	defer c.lock.Unlock()

	// validate
	if start < 0 {
		return fmt.Errorf("invalid start block number: %d", start)
	} else if start == 0 {
		return errors.New("initial state (block 0) is not allowed to delete")
	}

	if end == -1 {
		end = c.GetLastBlockNumber()
	}

	// delete in cache
	for i := start; i <= end; i++ {
		delete(c.Blocks, i)
	}

	// collect txHashes from database
	var txHashes []string
	err := database.DB.Select(
		&txHashes,
		"SELECT tx_hash FROM blocks WHERE uid = ? AND block_number >= ? AND block_number <= ?", c.UserId, start, end)

	// delete in database
	_, err = database.DB.Exec("DELETE FROM blocks WHERE uid = ? AND block_number >= ? AND block_number <= ?", c.UserId, start, end)
	if err != nil {
		return err
	}

	query, args, err := sqlx.In("DELETE FROM transactions WHERE hash IN (?)", txHashes)
	if err != nil {
		return err
	}
	query = sqlx.Rebind(sqlx.QUESTION, query)

	// delete transactions
	_, err = database.DB.Exec(query, args...)

	// check if block exists after end in cache
	remain := 0
	for _, block := range c.Blocks {
		if block.Number > end {
			remain++
		}
	}
	if remain > 0 {
		log.Errorf("remain %d blocks in cache after deleting blocks from %d to %d", remain, start, end)
	}

	// update last block number
	c.LastBlockNumber = start - 1

	return nil
}

func (c *Chain) Clear() error {
	c.lock.Lock()
	defer c.lock.Unlock()

	// clear database
	var txHashes []string
	if err := database.DB.Select(&txHashes, "SELECT tx_hash FROM blocks WHERE uid = ?", c.UserId); err != nil {
		return err
	}
	_, err := database.DB.Exec("DELETE FROM blocks WHERE uid = ?", c.UserId)
	if err != nil {
		return err
	}

	query, args, err := sqlx.In("DELETE FROM transactions WHERE hash IN (?)", txHashes)
	if err != nil {
		return err
	}

	query = sqlx.Rebind(sqlx.QUESTION, query)
	_, err = database.DB.Exec(query, args...)
	if err != nil {
		return err
	}

	c.Blocks = make(map[int64]*Block)
	c.Blocks[0] = InitialBlock()
	c.LastBlockNumber = 0
	return nil
}

func (c *Chain) InsertBlock(block *Block) {
	if _, ok := c.Blocks[block.Number]; ok {
		// already exists
		return
	}
	c.Blocks[block.Number] = block
	if block.Number > c.LastBlockNumber {
		c.LastBlockNumber = block.Number
	}
}

// ApplyTransaction applies a transaction to build the new state
func (c *Chain) ApplyTransaction(tx *Transaction, blockNumber int64) (*Block, error) {
	var lastState *State
	c.lock.Lock()
	defer c.lock.Unlock()

	lastBlock, exists := c.Blocks[c.LastBlockNumber]
	if !exists {
		lastState = NewState()
	} else {
		lastState = lastBlock.State
	}

	if lastState == nil {
		return nil, errors.New("last state is nil")
	}

	// block number should be last block number + 1, except for initializing
	newBlockNumber := blockNumber

	// pre-execute transaction
	updates, err := PreExecuteTransaction(lastState, tx, newBlockNumber)
	if err != nil {
		return nil, err
	}

	// apply transaction
	newState, err := updates.ApplyTransitions(lastState)
	if err != nil {
		return nil, err
	}

	// validate new state
	if err := newState.Validate(); err != nil {
		return nil, err
	}

	// create new block
	newBlock := NewBlock(newBlockNumber, newState, updates, lastBlock.Hash)

	// update chain
	c.InsertBlock(newBlock)
	log.Infof("block %d inserted to cache successfully", newBlock.Number)

	// save block & transaction to database
	func() {
		var marshaledContent []byte
		if tx.Content != nil {
			marshaledContent, err = json.Marshal(tx.Content)
			if err != nil {
				log.Error(err)
				return
			}
		}

		marshaledState, err := newState.ToBytes()
		if err != nil {
			log.Error(err)
			return
		}

		marshaledTransitions, err := updates.Transitions.ToBytes()

		ctx, err := database.DB.BeginTxx(context.Background(), nil)
		if err != nil {
			log.Error(err)
			return
		}

		_, err = ctx.Exec("INSERT INTO transactions (version, type, `from`, timestamp, content, hash) VALUES (?, ?, ?, ?, ?, ?)", tx.Version, tx.Type, tx.From, tx.Timestamp, marshaledContent, tx.Hash)
		if err != nil {
			log.Error(err)
			err := ctx.Rollback()
			if err != nil {
				return
			}
			return
		}

		_, err = ctx.Exec(
			"INSERT INTO blocks (uid, transitions, state, block_number, block_hash, tx_hash, prev_block_hash) VALUES (?, ?, ?, ?, ?, ?, ?)",
			c.UserId,
			marshaledTransitions,
			marshaledState,
			newBlock.Number,
			newBlock.Hash,
			newBlock.Updates.SrcTx.Hash,
			newBlock.PrevBlockHash,
		)
		if err != nil {
			log.Error(err)
			err := ctx.Rollback()
			if err != nil {
				log.Error(err)
				return
			}
			return
		}

		err = ctx.Commit()
		if err != nil {
			log.Error(err)
			return
		}

		log.Infof("transaction/block %d saved successfully", newBlock.Number)
	}()

	return newBlock, nil
}
