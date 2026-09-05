package migrations

// Version-specific SQL is immutable. Do not reuse/edit these builders for future versions.
func canonicalV3() Migration {
	id := "VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL"
	device := "CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL"
	common := "created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL, deleted_at BIGINT NULL, version BIGINT UNSIGNED NOT NULL, field_versions JSON NOT NULL"
	return Migration{Version: 3, Name: "canonical_entities_and_receipts", Statements: []string{
		"CREATE TABLE tasks (user_id BIGINT UNSIGNED NOT NULL,id " + id + ",title TEXT NOT NULL,memo LONGTEXT NOT NULL,done BOOLEAN NOT NULL,done_at BIGINT NOT NULL,due_date BIGINT NOT NULL,repeat_period VARCHAR(16) NOT NULL,repeat_start_at BIGINT NOT NULL,recurrence_generation BIGINT UNSIGNED NOT NULL,sort_rank DECIMAL(65,0) NOT NULL," + common + ",PRIMARY KEY(user_id,id),KEY task_order(user_id,deleted_at,sort_rank,id),KEY task_due(user_id,deleted_at,done,due_date),FOREIGN KEY(user_id) REFERENCES sync_users(id)) ENGINE=InnoDB",
		"CREATE TABLE categories (user_id BIGINT UNSIGNED NOT NULL,id " + id + ",title TEXT NOT NULL,secret BOOLEAN NOT NULL,locked BOOLEAN NOT NULL,color VARCHAR(32) NOT NULL," + common + ",PRIMARY KEY(user_id,id),FOREIGN KEY(user_id) REFERENCES sync_users(id)) ENGINE=InnoDB",
		"CREATE TABLE subtasks (user_id BIGINT UNSIGNED NOT NULL,task_id " + id + ",id " + id + ",title TEXT NOT NULL,done BOOLEAN NOT NULL,done_at BIGINT NOT NULL,due_date BIGINT NOT NULL," + common + ",PRIMARY KEY(user_id,task_id,id),FOREIGN KEY(user_id,task_id) REFERENCES tasks(user_id,id)) ENGINE=InnoDB",
		"CREATE TABLE task_categories (user_id BIGINT UNSIGNED NOT NULL,task_id " + id + ",category_id " + id + ",present BOOLEAN NOT NULL,updated_at BIGINT NOT NULL,version BIGINT UNSIGNED NOT NULL,PRIMARY KEY(user_id,task_id,category_id),KEY category_tasks(user_id,category_id,present),FOREIGN KEY(user_id,task_id) REFERENCES tasks(user_id,id),FOREIGN KEY(user_id,category_id) REFERENCES categories(user_id,id)) ENGINE=InnoDB",
		"CREATE TABLE sync_devices (user_id BIGINT UNSIGNED NOT NULL,device_id " + device + ",revoked_at BIGINT NULL,acknowledged_seq BIGINT UNSIGNED NOT NULL DEFAULT 0,last_seen_at BIGINT NOT NULL,PRIMARY KEY(user_id,device_id),FOREIGN KEY(user_id) REFERENCES sync_users(id)) ENGINE=InnoDB",
		"CREATE TABLE sync_change_log (user_id BIGINT UNSIGNED NOT NULL,seq BIGINT UNSIGNED NOT NULL,epoch " + device + ",device_id " + device + ",client_change_id " + device + ",payload JSON NOT NULL,created_at BIGINT NOT NULL,PRIMARY KEY(user_id,seq),KEY log_retention(user_id,created_at,seq),FOREIGN KEY(user_id) REFERENCES sync_users(id)) ENGINE=InnoDB",
		"CREATE TABLE sync_receipts (user_id BIGINT UNSIGNED NOT NULL,device_id " + device + ",client_change_id " + device + ",request_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,result JSON NOT NULL,created_at BIGINT NOT NULL,PRIMARY KEY(user_id,device_id,client_change_id),FOREIGN KEY(user_id,device_id) REFERENCES sync_devices(user_id,device_id)) ENGINE=InnoDB",
		"CREATE TABLE sync_occurrences (user_id BIGINT UNSIGNED NOT NULL,task_id " + id + ",generation BIGINT UNSIGNED NOT NULL,result JSON NOT NULL,PRIMARY KEY(user_id,task_id,generation),FOREIGN KEY(user_id,task_id) REFERENCES tasks(user_id,id)) ENGINE=InnoDB",
	}}
}
