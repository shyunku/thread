package migrations

func snapshotsV4() Migration {
	return Migration{Version: 4, Name: "immutable_sync_snapshots", Statements: []string{
		`CREATE TABLE sync_snapshots (
 user_id BIGINT UNSIGNED NOT NULL,
 id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 epoch CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 seq BIGINT UNSIGNED NOT NULL,
 page_count INT UNSIGNED NOT NULL,
 expires_at BIGINT NOT NULL,
 PRIMARY KEY(user_id,id),
 KEY snapshot_expiry(user_id,expires_at,seq),
 FOREIGN KEY(user_id) REFERENCES sync_users(id)
) ENGINE=InnoDB`,
		`CREATE TABLE sync_snapshot_pages (
 user_id BIGINT UNSIGNED NOT NULL,
 snapshot_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 page_number INT UNSIGNED NOT NULL,
 payload LONGBLOB NOT NULL,
 checksum CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 PRIMARY KEY(user_id,snapshot_id,page_number),
 FOREIGN KEY(user_id,snapshot_id) REFERENCES sync_snapshots(user_id,id)
) ENGINE=InnoDB`,
	}}
}
