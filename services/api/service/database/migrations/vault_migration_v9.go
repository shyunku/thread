package migrations

// Additive metadata/copies only. DDL never freezes or migrates an account.
func vaultMigrationV9() Migration {
	return Migration{Version: 9, Name: "vault_migration_checkpoints", Statements: []string{
		`CREATE TABLE vault_migrations (
 migration_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
 vault_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 source_user BIGINT UNSIGNED NOT NULL,
 coordinator VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 source_epoch CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 source_snapshot CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 freeze_seq BIGINT UNSIGNED NOT NULL,
 prior_vault_epoch VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 target_epoch CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 phase VARCHAR(24) NOT NULL,
 page_count INT UNSIGNED NOT NULL,
 object_count BIGINT UNSIGNED NOT NULL,
 created_at BIGINT NOT NULL,
 FOREIGN KEY(vault_id,coordinator) REFERENCES vault_devices(vault_id,device_id),
 FOREIGN KEY(source_user) REFERENCES sync_users(id),
 CHECK(phase IN ('FROZEN','UPLOADING','VERIFIED','COMMITTING','ACTIVE','CANCELLED'))
 ) ENGINE=InnoDB`,
		`CREATE TABLE vault_migration_active (
 vault_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
 migration_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
 FOREIGN KEY(vault_id) REFERENCES vaults(vault_id),
 FOREIGN KEY(migration_id) REFERENCES vault_migrations(migration_id)
 ) ENGINE=InnoDB`,
		`CREATE TABLE vault_migration_source_pages (
 migration_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 page_number INT UNSIGNED NOT NULL,
 payload LONGBLOB NOT NULL,
 checksum CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 PRIMARY KEY(migration_id,page_number),
 FOREIGN KEY(migration_id) REFERENCES vault_migrations(migration_id)
 ) ENGINE=InnoDB`,
	}}
}
