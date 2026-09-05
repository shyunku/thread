// Package migrations applies forward-only schema changes before serving requests.
// It does not switch account sync protocols or rewrite legacy task data.
package migrations

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"database/sql/driver"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"time"
)

type Migration struct {
	Version        int
	Name           string
	Statements     []string
	RequiredTables map[string][]string
}
type Applied struct {
	Version  int
	Name     string
	Checksum string
	State    string
}

func (m Migration) Checksum() string {
	data, _ := json.Marshal(m)
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}
func Validate(manifest []Migration, applied []Applied) error {
	for i, m := range manifest {
		if m.Version != i+1 || m.Name == "" {
			return fmt.Errorf("invalid migration manifest at version %d", m.Version)
		}
	}
	for i, a := range applied {
		if a.Version != i+1 || a.Version > len(manifest) {
			return fmt.Errorf("unsupported or non-contiguous schema version %d; do not downgrade", a.Version)
		}
		m := manifest[i]
		if a.Name != m.Name || a.Checksum != m.Checksum() {
			return fmt.Errorf("migration %d checksum mismatch; restore the original migration", a.Version)
		}
		if a.State != "applied" {
			return fmt.Errorf("migration %d incomplete; inspect and repair partial DDL before restarting", a.Version)
		}
	}
	return nil
}

// MySQL advisory locks are connection-scoped. DDL cannot be rolled back as a batch,
// so an applying marker deliberately blocks automatic replay after a partial failure.
func Run(ctx context.Context, db *sql.DB, manifest []Migration) (version int, err error) {
	if err = Validate(manifest, nil); err != nil {
		return 0, err
	}
	conn, err := db.Conn(ctx)
	if err != nil {
		return 0, err
	}
	defer conn.Close()
	var databaseName string
	if err = conn.QueryRowContext(ctx, "SELECT DATABASE()").Scan(&databaseName); err != nil {
		return 0, fmt.Errorf("migration requires a selected database")
	}
	lockHash := sha256.Sum256([]byte(databaseName))
	lockName := fmt.Sprintf("thread-schema-%x", lockHash[:20])
	var acquired sql.NullInt64
	if err = conn.QueryRowContext(ctx, "SELECT GET_LOCK(?, 10)", lockName).Scan(&acquired); err != nil {
		return 0, fmt.Errorf("schema migration lock unavailable")
	}
	if !acquired.Valid || acquired.Int64 != 1 {
		return 0, fmt.Errorf("schema migration lock timeout")
	}
	defer func() {
		releaseCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		var released sql.NullInt64
		releaseErr := conn.QueryRowContext(releaseCtx, "SELECT RELEASE_LOCK(?)", lockName).Scan(&released)
		if releaseErr != nil || !released.Valid || released.Int64 != 1 {
			_ = conn.Raw(func(interface{}) error { return driver.ErrBadConn })
			if err == nil {
				err = fmt.Errorf("schema migration lock release failed")
			}
		}
	}()
	_, err = conn.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS thread_schema_migrations (
 version INT NOT NULL PRIMARY KEY,
 name VARCHAR(128) NOT NULL,
 checksum CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 state VARCHAR(16) NOT NULL,
 applied_at_ms BIGINT NULL
 ) ENGINE=InnoDB`)
	if err != nil {
		return 0, fmt.Errorf("cannot initialize migration ledger")
	}
	rows, err := conn.QueryContext(ctx, "SELECT version, name, checksum, state FROM thread_schema_migrations ORDER BY version")
	if err != nil {
		return 0, fmt.Errorf("cannot read migration ledger")
	}
	applied := []Applied{}
	for rows.Next() {
		var a Applied
		if err = rows.Scan(&a.Version, &a.Name, &a.Checksum, &a.State); err != nil {
			rows.Close()
			return 0, fmt.Errorf("invalid migration ledger")
		}
		applied = append(applied, a)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return 0, fmt.Errorf("cannot finish reading migration ledger")
	}
	if err = Validate(manifest, applied); err != nil {
		return 0, err
	}
	version = len(applied)
	for _, m := range manifest[version:] {
		for table, columns := range m.RequiredTables {
			for _, column := range columns {
				var count int
				if err = conn.QueryRowContext(ctx,
					"SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=? AND column_name=?",
					table, column).Scan(&count); err != nil || count != 1 {
					return version, fmt.Errorf("migration %d: required column %s.%s missing or inaccessible", m.Version, table, column)
				}
			}
		}
		_, err = conn.ExecContext(ctx, "INSERT INTO thread_schema_migrations(version,name,checksum,state) VALUES (?,?,?,'applying')",
			m.Version, m.Name, m.Checksum())
		if err != nil {
			return version, fmt.Errorf("cannot record migration %d start", m.Version)
		}
		for i, statement := range m.Statements {
			if _, err = conn.ExecContext(ctx, statement); err != nil {
				// Do not expose SQL errors that might contain user data.
				return version, fmt.Errorf("migration %d statement %d failed; ledger remains incomplete", m.Version, i+1)
			}
		}
		_, err = conn.ExecContext(ctx, "UPDATE thread_schema_migrations SET state='applied',applied_at_ms=? WHERE version=? AND state='applying'",
			time.Now().UnixMilli(), m.Version)
		if err != nil {
			return version, fmt.Errorf("cannot finalize migration %d; inspect ledger", m.Version)
		}
		version = m.Version
	}
	return version, nil
}
