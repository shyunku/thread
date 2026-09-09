package migrations

// Additive metadata only. Creating these tables does not migrate an account,
// copy plaintext, generate client keys, or enable encrypted sync.
func vaultV6() Migration {
	return Migration{Version: 6, Name: "e2ee_vault_membership", Statements: []string{
		`CREATE TABLE vaults (
 vault_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
 account_id VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
 mode VARCHAR(24) NOT NULL DEFAULT 'pending',
 epoch VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 suite VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 membership_revision BIGINT UNSIGNED NOT NULL DEFAULT 0,
 current_key_generation BIGINT UNSIGNED NOT NULL DEFAULT 1,
 genesis_digest BINARY(32) NOT NULL,
 membership_head BINARY(32) NOT NULL,
 recovery_public_key BINARY(32) NOT NULL,
 UNIQUE KEY vault_account(account_id),
 CHECK(mode IN ('pending','migrating','active'))
 ) ENGINE=InnoDB`,
		`CREATE TABLE vault_membership_events (
 vault_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 revision BIGINT UNSIGNED NOT NULL,
 event_digest BINARY(32) NOT NULL,
 previous_digest BINARY(32) NULL,
 signed_record MEDIUMBLOB NOT NULL,
 PRIMARY KEY(vault_id,revision),
 UNIQUE KEY vault_event_digest(vault_id,event_digest),
 FOREIGN KEY(vault_id) REFERENCES vaults(vault_id),
 CHECK(OCTET_LENGTH(signed_record) BETWEEN 1 AND 1048576)
 ) ENGINE=InnoDB`,
		`CREATE TABLE vault_devices (
 vault_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 device_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 signing_public_key BINARY(32) NOT NULL,
 encryption_public_key BINARY(32) NOT NULL,
 role VARCHAR(8) NOT NULL,
 can_authorize_devices BOOLEAN NOT NULL DEFAULT FALSE,
 approved_revision BIGINT UNSIGNED NOT NULL,
 revoked_revision BIGINT UNSIGNED NULL,
 last_counter BIGINT UNSIGNED NOT NULL DEFAULT 0,
 PRIMARY KEY(vault_id,device_id),
 UNIQUE KEY vault_signing_key(vault_id,signing_public_key),
 FOREIGN KEY(vault_id,approved_revision) REFERENCES vault_membership_events(vault_id,revision),
 FOREIGN KEY(vault_id,revoked_revision) REFERENCES vault_membership_events(vault_id,revision),
 CHECK(role IN ('read','write')),
 CHECK(can_authorize_devices IN (0,1)),
 CHECK(revoked_revision IS NULL OR revoked_revision>approved_revision)
 ) ENGINE=InnoDB`,
		`CREATE TABLE vault_key_envelopes (
 vault_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 recipient_device_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 key_generation BIGINT UNSIGNED NOT NULL,
 membership_revision BIGINT UNSIGNED NOT NULL,
 signed_envelope MEDIUMBLOB NOT NULL,
 PRIMARY KEY(vault_id,recipient_device_id,key_generation),
 FOREIGN KEY(vault_id,recipient_device_id) REFERENCES vault_devices(vault_id,device_id),
 FOREIGN KEY(vault_id,membership_revision) REFERENCES vault_membership_events(vault_id,revision),
 CHECK(key_generation>0),
 CHECK(OCTET_LENGTH(signed_envelope) BETWEEN 1 AND 1048576)
 ) ENGINE=InnoDB`,
	}}
}
