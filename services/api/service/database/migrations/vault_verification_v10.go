package migrations

func vaultVerificationV10() Migration {
	return Migration{Version: 10, Name: "vault_migration_attestation", Statements: []string{
		`CREATE TABLE vault_migration_verifications (
 migration_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
 snapshot_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 ciphertext_manifest BINARY(32) NOT NULL,
 stage_seq BIGINT UNSIGNED NOT NULL,
 membership_head BINARY(32) NOT NULL,
 key_generation BIGINT UNSIGNED NOT NULL,
 object_count BIGINT UNSIGNED NOT NULL,
 signed_attestation MEDIUMBLOB NOT NULL,
 FOREIGN KEY(migration_id) REFERENCES vault_migrations(migration_id)
 ) ENGINE=InnoDB`,
	}}
}
