package migrations

func encryptedV7() Migration {
	return Migration{Version: 7, Name: "encrypted_sync_storage", Statements: []string{
		`CREATE TABLE vault_sync (
 vault_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
 last_seq BIGINT UNSIGNED NOT NULL DEFAULT 0,
 FOREIGN KEY(vault_id) REFERENCES vaults(vault_id)
 ) ENGINE=InnoDB`,
		`CREATE TABLE encrypted_objects (
 vault_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 object_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 version BIGINT UNSIGNED NOT NULL,
 seq BIGINT UNSIGNED NOT NULL,
 deleted BOOLEAN NOT NULL,
 operation_index INT UNSIGNED NOT NULL,
 signed_record MEDIUMBLOB NOT NULL,
 PRIMARY KEY(vault_id,object_id),
 KEY encrypted_object_seq(vault_id,seq,object_id),
 FOREIGN KEY(vault_id) REFERENCES vaults(vault_id)
 ) ENGINE=InnoDB`,
		`CREATE TABLE encrypted_changes (
 vault_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 seq BIGINT UNSIGNED NOT NULL,
 signed_record MEDIUMBLOB NOT NULL,
 result MEDIUMBLOB NOT NULL,
 PRIMARY KEY(vault_id,seq),
 FOREIGN KEY(vault_id) REFERENCES vaults(vault_id)
 ) ENGINE=InnoDB`,
		`CREATE TABLE encrypted_receipts (
 vault_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 device_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 mutation_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 counter BIGINT UNSIGNED NOT NULL,
 request_digest BINARY(32) NOT NULL,
 result MEDIUMBLOB NOT NULL,
 PRIMARY KEY(vault_id,device_id,mutation_id),
 UNIQUE KEY encrypted_counter(vault_id,device_id,counter),
 FOREIGN KEY(vault_id,device_id) REFERENCES vault_devices(vault_id,device_id)
 ) ENGINE=InnoDB`,
	}}
}
