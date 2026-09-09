package migrations

func encryptedSnapshotsV8() Migration {
	return Migration{Version: 8, Name: "encrypted_immutable_snapshots", Statements: []string{
		`CREATE TABLE encrypted_snapshots (
 id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
 vault_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 epoch VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 seq BIGINT UNSIGNED NOT NULL,
 membership_head BINARY(32) NOT NULL,
 manifest_digest BINARY(32) NOT NULL,
 object_count BIGINT UNSIGNED NOT NULL,
 expires_at BIGINT NOT NULL,
 FOREIGN KEY(vault_id) REFERENCES vaults(vault_id)
 ) ENGINE=InnoDB`,
		`CREATE TABLE encrypted_snapshot_objects (
 snapshot_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 object_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 version BIGINT UNSIGNED NOT NULL,
 seq BIGINT UNSIGNED NOT NULL,
 deleted BOOLEAN NOT NULL,
 operation_index INT UNSIGNED NOT NULL,
 signed_record MEDIUMBLOB NOT NULL,
 PRIMARY KEY(snapshot_id,object_id),
 FOREIGN KEY(snapshot_id) REFERENCES encrypted_snapshots(id)
 ) ENGINE=InnoDB`,
	}}
}
