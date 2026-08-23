package v1

import (
	"errors"
	"fmt"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"memorial_app_server/log"
	"memorial_app_server/service/state"
	"memorial_app_server/util"
)

type socketHandler func(socket *UserSocket, uid string, data interface{}) (interface{}, error)

var (
	socketHandlers = map[string]socketHandler{
		"test":                   test,
		"transaction":            handleTransaction,
		"waitingBlockNumber":     waitingBlockNumber,
		"lastBlockNumber":        lastBlockNumber,
		"lastRemoteBlock":        lastRemoteBlock,
		"syncBlocks":             syncBlocks,
		"commitTransactions":     commitTransactions,
		"txHashByBlockNumber":    txHashByBlockNumber,
		"blockHashByBlockNumber": blockHashByBlockNumber,
		"deleteMismatchBlocks":   deleteMismatchBlocks,
		"blockByBlockNumber":     blockByBlockNumber,
		"stateByBlockNumber":     stateByBlockNumber,
		"clearStatePermanently":  clearStatePermanently,
	}
	SocketBundles = map[string]*UserSocketBundle{}
)

func test(socket *UserSocket, uid string, data interface{}) (interface{}, error) {
	// data to string
	str, ok := data.(string)
	if !ok {
		return nil, errors.New("invalid data type")
	}
	return str, nil
}

func handleTransaction(socket *UserSocket, uid string, data interface{}) (interface{}, error) {
	var request TxSocketRequest
	if err := util.InterfaceToStruct(data, &request); err != nil {
		log.Errorf("Failed to unmarshal data: %v", data)
		return nil, fmt.Errorf("invalid request: check format")
	}
	userChain := state.Chains.GetChain(uid)

	log.Debug(request)

	// check version
	if request.Version != state.SchemeVersion {
		log.Errorf("Invalid version: waiting for %d, but %d given", state.SchemeVersion, request.Version)
		return nil, fmt.Errorf("invalid version: waiting for %d", state.SchemeVersion)
	}

	// check if targetBlockNumber is valid
	waitingBlockNumber := userChain.GetWaitingBlockNumber()
	initializing := request.Type == state.TxInitialize
	if !initializing && request.BlockNumber != waitingBlockNumber {
		// different block number
		log.Errorf("Invalid target block number: waiting for block #%d, but #%d given", waitingBlockNumber, request.BlockNumber)
		return nil, fmt.Errorf("invalid block number: waiting for block #%d, but #%d given", waitingBlockNumber, request.BlockNumber)
	}

	// check if transaction is valid
	tx := state.NewTransaction(request.Version, uid, request.Type, request.Timestamp, request.Content, request.Hash)
	if err := tx.Validate(); err != nil {
		log.Error("Invalid transaction")
		return nil, fmt.Errorf("invalid request: %s", err.Error())
	}

	// check transaction hash (doesn't check - v0.2.2)
	//if request.Hash != tx.Hash {
	//	log.Errorf("Invalid transaction hash: expected for %s, but %s given", tx.Hash, request.Hash)
	//	return nil, fmt.Errorf("invalid transaction hash: waiting for %s", tx.Hash)
	//}

	// check block hash (expect)
	//if !initializing {
	//	prevBlock, err := userChain.GetBlockByNumber(request.BlockNumber - 1)
	//	if err != nil {
	//		log.Errorf("Failed to get previous block: %v", err)
	//		return nil, fmt.Errorf("failed to get previous block: %s", err.Error())
	//	}
	//	prevBlockHash := prevBlock.Hash
	//	expectedBlockHash := state.ExpectedBlockHash(request.BlockNumber, request.Hash, prevBlockHash).Hex()
	//	if request.BlockHash != expectedBlockHash {
	//		log.Errorf("Invalid block hash: expected for %s, but %s given", expectedBlockHash, request.BlockHash)
	//		return nil, fmt.Errorf("invalid block hash: waiting for %s, given: %s", expectedBlockHash, request.BlockHash)
	//	}
	//}

	// apply transaction
	newBlock, err := userChain.ApplyTransaction(tx, request.BlockNumber)
	if err != nil {
		log.Errorf("Error during applying transaction: %v", err)
		return nil, fmt.Errorf("failed to apply transaction: %s", err.Error())
	}

	go func() {
		// broadcast transaction to same user connections
		bundle, ok := SocketBundles[uid]
		if !ok {
			log.Warnf("Couldn't find socket bundle for user %s", uid)
		}

		updatedLastBlockNumber := userChain.GetLastBlockNumber()

		for _, sock := range bundle.sockets {
			// send updated waiting block number
			if err := sock.Emit("last_block_number", updatedLastBlockNumber); err != nil {
				log.Warnf("Failed to broadcast waiting block number to user %s [%s]", uid, sock.ConnectionId)
			}

			// send transaction
			if err := sock.Emit("broadcast_transaction", newBlock); err != nil {
				log.Warnf("Failed to broadcast transaction to user %s [%s]", uid, sock.ConnectionId)
			}
		}
	}()

	return nil, nil
}

func lastRemoteBlock(socket *UserSocket, uid string, data interface{}) (interface{}, error) {
	userChain := state.Chains.GetChain(uid)
	lastBlockNumber := userChain.GetLastBlockNumber()
	lastBlock, err := userChain.GetBlockByNumber(lastBlockNumber)
	if err != nil {
		log.Errorf("Failed to get last block: %v", err)
		return nil, fmt.Errorf("failed to get last block: %s", err.Error())
	}
	return lastBlock, nil
}

func txHashByBlockNumber(socket *UserSocket, uid string, data interface{}) (interface{}, error) {
	var request TxHashByBlockNumberSocketRequest
	if err := util.InterfaceToStruct(data, &request); err != nil {
		log.Errorf("Failed to unmarshal data: %v", data)
		return nil, fmt.Errorf("invalid request: check format")
	}

	userChain := state.Chains.GetChain(uid)
	block, err := userChain.GetBlockByNumber(request.BlockNumber)
	if err != nil {
		log.Errorf("Failed to get block: %v", err)
		return nil, fmt.Errorf("failed to get block: %s", err.Error())
	}
	tx := block.Updates.SrcTx
	if tx == nil {
		log.Errorf("Failed to get transaction from block: %v", block)
		return nil, fmt.Errorf("failed to get transaction from block: %v", block)
	}

	return tx.Hash, nil
}

func blockHashByBlockNumber(socket *UserSocket, uid string, data interface{}) (interface{}, error) {
	var request BlockHashByBlockNumberSocketRequest
	if err := util.InterfaceToStruct(data, &request); err != nil {
		log.Errorf("Failed to unmarshal data: %v", data)
		return nil, fmt.Errorf("invalid request: check format")
	}

	userChain := state.Chains.GetChain(uid)
	block, err := userChain.GetBlockByNumber(request.BlockNumber)
	if err != nil {
		log.Errorf("Failed to get block: %v", err)
		return nil, fmt.Errorf("failed to get block: %s", err.Error())
	}

	return block.Hash, nil
}

func waitingBlockNumber(socket *UserSocket, uid string, data interface{}) (interface{}, error) {
	userChain := state.Chains.GetChain(uid)
	return userChain.GetWaitingBlockNumber(), nil
}

func lastBlockNumber(socket *UserSocket, uid string, data interface{}) (interface{}, error) {
	userChain := state.Chains.GetChain(uid)
	return userChain.GetLastBlockNumber(), nil
}

func syncBlocks(socket *UserSocket, uid string, data interface{}) (interface{}, error) {
	var request SyncBlocksSocketRequest
	if err := util.InterfaceToStruct(data, &request); err != nil {
		log.Errorf("Failed to unmarshal data: %v", data)
		return nil, fmt.Errorf("invalid request: check format")
	}

	userChain := state.Chains.GetChain(uid)

	startBlockNumber := request.StartBlockNumber
	endBlockNumber := request.EndBlockNumber

	// check if startBlockNumber is smaller than endBlockNumber
	if startBlockNumber > endBlockNumber {
		log.Error("Invalid block number range")
		return nil, fmt.Errorf("invalid block number range: start block number is greater than end block number")
	}

	// fetch blocks from chain
	blocks, err := userChain.GetBlocksByInterval(startBlockNumber, endBlockNumber)
	if err != nil {
		log.Error("Error during fetching blocks")
		return nil, fmt.Errorf("failed to fetch blocks: %s", err.Error())
	}

	return blocks, nil
}

func commitTransactions(socket *UserSocket, uid string, data interface{}) (interface{}, error) {
	var request CommitTxBundleSocketRequest
	if err := util.InterfaceToStruct(data, &request); err != nil {
		log.Errorf("Failed to unmarshal data: %v", data)
		return nil, fmt.Errorf("invalid request: check format")
	}

	for _, txReq := range request {
		_, err := handleTransaction(socket, uid, txReq)
		if err != nil {
			log.Error("Error during handling transaction: ", err)
			return nil, err
		}
	}

	return nil, nil
}

func deleteMismatchBlocks(socket *UserSocket, uid string, data interface{}) (interface{}, error) {
	var request DeleteMismatchBlocksSocketRequest
	if err := util.InterfaceToStruct(data, &request); err != nil {
		log.Errorf("Failed to unmarshal data: %v", data)
		return nil, fmt.Errorf("invalid request: check format")
	}

	// validate request
	if request.EndBlockNumber != -1 && request.StartBlockNumber > request.EndBlockNumber {
		log.Error("Invalid block number range")
		return nil, fmt.Errorf("invalid block number range: start block number is greater than end block number")
	}

	userChain := state.Chains.GetChain(uid)
	if err := userChain.DeleteBlockByInterval(request.StartBlockNumber, request.EndBlockNumber); err != nil {
		log.Error("Error during deleting blocks: ", err)
		return nil, fmt.Errorf("failed to delete blocks: %s", err.Error())
	}

	// broadcast transaction to same user connections
	bundle, ok := SocketBundles[uid]
	if !ok {
		log.Warnf("Couldn't find socket bundle for user %s", uid)
	}

	updatedLastBlockNumber := userChain.GetLastBlockNumber()

	for _, sock := range bundle.sockets {
		// send transaction

		if sock.ConnectionId != socket.ConnectionId {
			// except sender
			if err := sock.Emit("delete_transaction_after", request.StartBlockNumber); err != nil {
				log.Warnf("Failed to broadcast transaction to user %s [%s]", uid, sock.ConnectionId)
			}
		}

		// send updated waiting block number
		if err := sock.Emit("last_block_number", updatedLastBlockNumber); err != nil {
			log.Warnf("Failed to broadcast waiting block number to user %s [%s]", uid, sock.ConnectionId)
		}
	}

	return nil, nil
}

func blockByBlockNumber(socket *UserSocket, uid string, data interface{}) (interface{}, error) {
	var request BlockByBlockNumberSocketRequest
	if err := util.InterfaceToStruct(data, &request); err != nil {
		log.Errorf("Failed to unmarshal data: %v", data)
		return nil, fmt.Errorf("invalid request: check format")
	}

	userChain := state.Chains.GetChain(uid)
	block, err := userChain.GetBlockByNumber(request.BlockNumber)
	if err != nil {
		log.Errorf("Failed to get block: %v", err)
		return nil, fmt.Errorf("failed to get block: %s", err.Error())
	}

	return block, nil
}

func stateByBlockNumber(socket *UserSocket, uid string, data interface{}) (interface{}, error) {
	var request StateByBlockNumberSocketRequest
	if err := util.InterfaceToStruct(data, &request); err != nil {
		log.Errorf("Failed to unmarshal data: %v", data)
		return nil, fmt.Errorf("invalid request: check format")
	}

	userChain := state.Chains.GetChain(uid)
	block, err := userChain.GetBlockByNumber(request.BlockNumber)
	if err != nil {
		log.Errorf("Failed to get block: %v", err)
		return nil, fmt.Errorf("failed to get block: %s", err.Error())
	}
	blockState := block.State
	if blockState == nil {
		log.Errorf("Failed to get state from block: %v", block)
		return nil, fmt.Errorf("failed to get state from block: %v", block)
	}

	return blockState, nil
}

func clearStatePermanently(socket *UserSocket, uid string, data interface{}) (interface{}, error) {
	userChain := state.Chains.GetChain(uid)
	if err := userChain.Clear(); err != nil {
		log.Errorf("Failed to clear chain: %v", err)
		return nil, fmt.Errorf("failed to clear chain: %s", err.Error())
	}
	return nil, nil
}

func SocketV1(c *gin.Context) {
	upgrader := websocket.Upgrader{}
	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Error("Error during connection upgrader: ", err)
		return
	}

	connectionId := uuid.New().String()
	rawUid, ok := c.Get("uid")
	if !ok {
		log.Error("Error during getting uid from context")
		return
	}
	uid, ok := rawUid.(string)
	if !ok {
		log.Errorf("Error during casting uid to string: %v", rawUid)
		return
	}

	printStat(connectionId, uid, "connected")

	var socketBundle *UserSocketBundle
	var bundleExists bool
	if socketBundle, bundleExists = SocketBundles[uid]; !bundleExists {
		// socket bundle has to be created
		socketBundle = NewUserSocketBundle(uid)
		SocketBundles[uid] = socketBundle
	}

	socket := socketBundle.AddSocket(connectionId, conn, func(socket *UserSocket, topic string, data interface{}) error {
		sendPacket := &SocketSendPacket{
			Topic:      topic,
			Data:       data,
			RequestId:  "",
			Success:    true,
			ErrMessage: "",
		}

		sendMessage, err := sendPacket.bytes()
		if err != nil {
			log.Error("Error during creating packet: ", err)
			return err
		}

		socket.connMutex.Lock()
		defer socket.connMutex.Unlock()
		// write out a message
		if err := socket.Conn.WriteMessage(websocket.BinaryMessage, sendMessage); err != nil {
			log.Error("Error during writing message: ", err)
			return err
		}

		return nil
	})

	defer func() {
		socketBundle.RemoveSocket(connectionId)
		if socketBundle.GetSize() == 0 {
			delete(SocketBundles, uid)
		}
		conn.Close()
	}()

	conn.SetCloseHandler(func(code int, text string) error {
		printStat(connectionId, uid, fmt.Sprintf("Disconnected: %d", code))
		return nil
	})

	for {
		// read in a message
		msgType, msg, err := conn.ReadMessage()
		if err != nil {
			log.Debug("Error during reading message: ", err)
			return
		}

		recvPacket, err := ToPacket(msg)
		if err != nil {
			// uncaught raw messages
			log.Warnf("Uncaught raw message: %s", string(msg))
			continue
		}

		printStat(
			connectionId,
			uid,
			fmt.Sprintf("[%s] message<%s> %v", shorten(recvPacket.RequestId), recvPacket.Topic, recvPacket.Data),
		)

		// find handler
		handler, ok := socketHandlers[recvPacket.Topic]
		if !ok {
			log.Warnf("Uncaught message: %s", string(msg))
			continue
		}

		// handle message
		resp, err := handler(socket, uid, recvPacket.Data)
		sendPacket := &SocketSendPacket{
			Topic:      recvPacket.Topic,
			Data:       resp,
			RequestId:  recvPacket.RequestId,
			Success:    err == nil,
			ErrMessage: "",
		}
		if err != nil {
			sendPacket.ErrMessage = err.Error()
		}

		sendMessage, err := sendPacket.bytes()
		if err != nil {
			log.Error("Error during creating packet: ", err)
			continue
		}

		// write out a message
		socket.connMutex.Lock()
		if err := socket.Conn.WriteMessage(msgType, sendMessage); err != nil {
			socket.connMutex.Unlock()
			log.Error("Error during writing message: ", err)
			continue
		}
		socket.connMutex.Unlock()
	}
}

func shorten(str string) string {
	if len(str) > 5 {
		return str[:5]
	}
	return str
}

func printStat(connectionId string, uid string, text string) {
	if len(text) > 100 {
		text = text[:100] + "..."
	}
	log.Infof("Client[%s] User[%s]: %s", shorten(connectionId), uid, text)
}

func UseSocketRouter(g *gin.RouterGroup) {
	sg := g.Group("/websocket")
	sg.Use(AuthMiddleware)
	sg.Any("/connect", SocketV1)
}
