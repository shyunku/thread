package migrations

// Additive cutover: preserve EVERY old signed_record byte. New writes use refs.
// Duplicate removal is a separate, explicitly approved operational migration.
func encryptedRecordsV11() Migration {
	statements := []string{`CREATE TABLE encrypted_records (
 vault_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 record_digest BINARY(32) NOT NULL,
 signed_record MEDIUMBLOB NOT NULL,
 PRIMARY KEY(vault_id,record_digest),
 FOREIGN KEY(vault_id) REFERENCES vaults(vault_id)
 ) ENGINE=InnoDB`}
	for _, table := range []string{"encrypted_objects", "encrypted_changes", "encrypted_snapshot_objects"} {
		if table == "encrypted_snapshot_objects" {
			statements = append(statements, "ALTER TABLE "+table+" ADD COLUMN vault_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL", "UPDATE "+table+" o JOIN encrypted_snapshots s ON s.id=o.snapshot_id SET o.vault_id=s.vault_id", "ALTER TABLE "+table+" MODIFY vault_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL")
		}
		statements = append(statements,
			"INSERT INTO encrypted_records(vault_id,record_digest,signed_record) SELECT vault_id,UNHEX(SHA2(signed_record,256)),signed_record FROM "+table+" WHERE 1=1 ON DUPLICATE KEY UPDATE signed_record=IF(encrypted_records.signed_record=VALUES(signed_record),encrypted_records.signed_record,NULL)",
			"ALTER TABLE "+table+" ADD COLUMN record_digest BINARY(32) NULL, MODIFY signed_record MEDIUMBLOB NULL",
			"UPDATE "+table+" SET record_digest=UNHEX(SHA2(signed_record,256))",
			"ALTER TABLE "+table+" ADD FOREIGN KEY(vault_id,record_digest) REFERENCES encrypted_records(vault_id,record_digest)")
	}
	return Migration{Version: 11, Name: "shared_signed_records_preserve_originals", Statements: statements}
}
