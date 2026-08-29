package v1

import (
	"encoding/json"
	"github.com/gorilla/websocket"
	"sync"
)

type SocketPacket struct {
	Topic     string      `json:"topic"`
	Data      interface{} `json:"data"`
	RequestId string      `json:"reqId"`
}

func ToPacket(raw []byte) (*SocketPacket, error) {
	var packet SocketPacket
	err := json.Unmarshal(raw, &packet)
	if err != nil {
		return nil, err
	}
	return &packet, nil
}

type SocketSendPacket struct {
	Topic      string      `json:"topic"`
	Data       interface{} `json:"data"`
	RequestId  string      `json:"reqId"`
	Success    bool        `json:"success"`
	ErrMessage string      `json:"err_message"`
}

func (p *SocketSendPacket) bytes() ([]byte, error) {
	return json.Marshal(p)
}

type UserSocketEmitter func(socket *UserSocket, topic string, data interface{}) error

type UserSocket struct {
	ConnectionId string
	Conn         *websocket.Conn
	Emitter      UserSocketEmitter
	connMutex    sync.Mutex
}

func NewUserSocket(connectionId string, conn *websocket.Conn, emitter UserSocketEmitter) *UserSocket {
	return &UserSocket{
		ConnectionId: connectionId,
		Conn:         conn,
		Emitter:      emitter,
	}
}

func (s *UserSocket) Emit(topic string, data interface{}) error {
	//log.Debug("emit -> ", topic, data)
	//s.connMutex.Lock()
	//defer s.connMutex.Unlock()
	return s.Emitter(s, topic, data)
}

type UserSocketBundle struct {
	UserId  string
	sockets map[string]*UserSocket
}

func NewUserSocketBundle(userId string) *UserSocketBundle {
	return &UserSocketBundle{
		UserId:  userId,
		sockets: map[string]*UserSocket{},
	}
}

func (b *UserSocketBundle) AddSocket(connectionId string, conn *websocket.Conn, emitter UserSocketEmitter) *UserSocket {
	userSocket := NewUserSocket(connectionId, conn, emitter)
	b.sockets[connectionId] = userSocket
	return userSocket
}

func (b *UserSocketBundle) RemoveSocket(connectionId string) {
	delete(b.sockets, connectionId)
}

func (b *UserSocketBundle) GetSocket(connectionId string) *UserSocket {
	return b.sockets[connectionId]
}

func (b *UserSocketBundle) GetSize() int {
	return len(b.sockets)
}

/* -------------------------------- Custom -------------------------------- */

type TxSocketRequest struct {
	Version     int         `json:"version"`
	Type        int64       `json:"type"`
	Timestamp   int64       `json:"timestamp"`
	Content     interface{} `json:"content"`
	BlockNumber int64       `json:"blockNumber"` // target block number as string (e.g. "1051240")
	Hash        string      `json:"hash"`
	BlockHash   string      `json:"blockHash"`
}

type TxHashByBlockNumberSocketRequest struct {
	BlockNumber int64 `json:"blockNumber"`
}

type BlockHashByBlockNumberSocketRequest struct {
	BlockNumber int64 `json:"blockNumber"`
}

type SyncBlocksSocketRequest struct {
	StartBlockNumber int64 `json:"startBlockNumber"`
	EndBlockNumber   int64 `json:"endBlockNumber"`
}

type CommitTxBundleSocketRequest []TxSocketRequest

type DeleteMismatchBlocksSocketRequest struct {
	StartBlockNumber int64 `json:"startBlockNumber"`
	EndBlockNumber   int64 `json:"endBlockNumber"`
}

type StateByBlockNumberSocketRequest struct {
	BlockNumber int64 `json:"blockNumber"`
}

type BlockByBlockNumberSocketRequest struct {
	BlockNumber int64 `json:"blockNumber"`
}
