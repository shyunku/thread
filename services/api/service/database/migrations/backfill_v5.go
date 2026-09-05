package migrations

func backfillV5() Migration {
	return Migration{Version: 5, Name: "legacy_backfill_receipts", Statements: []string{
		`CREATE TABLE sync_backfills (
 user_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
 source_checksum CHAR(64) NOT NULL,
 rows_checksum CHAR(64) NOT NULL,
 epoch CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 completed_at BIGINT NOT NULL,
 FOREIGN KEY(user_id) REFERENCES sync_users(id)
 ) ENGINE=InnoDB`,
	}}
}
