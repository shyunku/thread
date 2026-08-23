package database

type AdminEntity struct {
	UserId *string `db:"uid" json:"userId"`
}

type UserEntity struct {
	UserId                *string `db:"uid" json:"userId"`
	Username              *string `db:"username" json:"username"`
	AuthId                *string `db:"auth_id" json:"authId"`
	AuthEncryptedPw       *string `db:"auth_encrypted_pw" json:"-"`
	AuthProfileImageUrl   *string `db:"auth_profile_image_url" json:"authProfileImageUrl"`
	GoogleAuthId          *string `db:"google_auth_id" json:"googleAuthId"`
	GoogleEmail           *string `db:"google_email" json:"googleEmail"`
	GoogleProfileImageUrl *string `db:"google_profile_image_url" json:"googleProfileImageUrl"`
}

type BlockEntity struct {
	UserId        *string `db:"uid" json:"userId"`
	State         []byte  `db:"state" json:"state"`
	Transitions   []byte  `db:"transitions" json:"transitions"`
	Number        *int64  `db:"block_number" json:"blockNumber"`
	TxHash        *string `db:"tx_hash" json:"txHash"`
	BlockHash     *string `db:"block_hash" json:"blockHash"`
	PrevBlockHash *string `db:"prev_block_hash" json:"prevBlockHash"`
}

type TransactionEntity struct {
	TxId      *int64  `db:"txid" json:"txId"`
	Version   *int    `db:"version" json:"version"`
	Type      *int64  `db:"type" json:"type"`
	From      *string `db:"from" json:"from"`
	Timestamp *int64  `db:"timestamp" json:"timestamp"`
	Content   []byte  `db:"content" json:"content"`
	Hash      *string `db:"hash" json:"hash"`
}
