package migrations

// Independent of app version and STATE_SCHEME_VERSION. New versions are appended,
// never edited after release. These migrations do not enable v2 account writes.
var Server = []Migration{
	{
		Version: 1,
		Name:    "legacy_schema_baseline",
		RequiredTables: map[string][]string{
			"user_master":  {"uid"},
			"transactions": {"txid", "version", "type", "from", "timestamp", "content", "hash"},
			"blocks":       {"uid", "block_number", "state", "transitions", "tx_hash", "block_hash", "prev_block_hash"},
		},
	},
	{
		Version: 2,
		Name:    "sync_account_metadata",
		Statements: []string{
			`CREATE TABLE sync_users (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    uid VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    mode VARCHAR(16) NOT NULL DEFAULT 'legacy',
    epoch CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
    last_seq BIGINT UNSIGNED NOT NULL DEFAULT 0,
    min_available_seq BIGINT UNSIGNED NOT NULL DEFAULT 1,
    migration_run_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
    UNIQUE KEY sync_users_uid (uid)
   ) ENGINE=InnoDB`,
		},
	},
}
