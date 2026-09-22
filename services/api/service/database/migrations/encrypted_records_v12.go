package migrations

func encryptedRecordsV12() Migration {
	tables := []string{"encrypted_objects", "encrypted_changes", "encrypted_snapshot_objects"}
	required := map[string][]string{"encrypted_records": {"vault_id", "record_digest", "signed_record"}}
	checks := []PreflightCheck{{
		Name:  "shared_record_digest",
		Query: "SELECT COUNT(*) FROM encrypted_records WHERE record_digest<>UNHEX(SHA2(signed_record,256))",
	}}
	statements := make([]string, 0, len(tables))
	for _, table := range tables {
		required[table] = []string{"vault_id", "record_digest", "signed_record"}
		checks = append(checks, PreflightCheck{
			Name:  table + "_shared_record",
			Query: "SELECT COUNT(*) FROM " + table + " o LEFT JOIN encrypted_records r ON r.vault_id=o.vault_id AND r.record_digest=o.record_digest WHERE o.record_digest IS NULL OR r.record_digest IS NULL OR (o.signed_record IS NOT NULL AND (o.record_digest<>UNHEX(SHA2(o.signed_record,256)) OR NOT(o.signed_record <=> r.signed_record)))",
		})
		statements = append(statements, "ALTER TABLE "+table+" MODIFY record_digest BINARY(32) NOT NULL, DROP COLUMN signed_record")
	}
	return Migration{
		Version:        12,
		Name:           "remove_duplicate_signed_records",
		RequiredTables: required,
		Preflight:      checks,
		Statements:     statements,
	}
}
