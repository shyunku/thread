package v1

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/go-sql-driver/mysql"
	"github.com/jmoiron/sqlx"
	"thread_api/service/database"
	"thread_api/service/database/migrations"
)

func TestMySQLSignupModes(t *testing.T) {
	dsn := os.Getenv("THREAD_SIGNUP_TEST_DSN")
	if dsn == "" {
		t.Skip("requires an empty disposable thread_signup_test_* database")
	}
	cfg, err := mysql.ParseDSN(dsn)
	if err != nil || !strings.HasPrefix(cfg.DBName, "thread_signup_test_") {
		t.Fatal("disposable signup database required")
	}
	raw, err := sql.Open("mysql", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer raw.Close()
	var count int
	if err = raw.QueryRow("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE()").Scan(&count); err != nil || count != 0 {
		t.Fatal("empty disposable signup database required", err)
	}
	for _, query := range []string{
		`CREATE TABLE user_master(uid VARCHAR(255) PRIMARY KEY,username VARCHAR(255),auth_id VARCHAR(255) UNIQUE,auth_encrypted_pw VARCHAR(255),auth_profile_image_url TEXT,google_auth_id VARCHAR(255) UNIQUE,google_email VARCHAR(255),google_profile_image_url TEXT) ENGINE=InnoDB`,
		`CREATE TABLE transactions(txid INT,version INT,type INT,` + "`from`" + ` VARCHAR(255),timestamp BIGINT,content BLOB,hash VARCHAR(255)) ENGINE=InnoDB`,
		`CREATE TABLE blocks(uid VARCHAR(255),block_number BIGINT,state LONGBLOB,transitions LONGBLOB,tx_hash VARCHAR(255),block_hash VARCHAR(255),prev_block_hash VARCHAR(255)) ENGINE=InnoDB`,
	} {
		if _, err = raw.Exec(query); err != nil {
			t.Fatal(err)
		}
	}
	if _, err = migrations.Run(context.Background(), raw, migrations.Server); err != nil {
		t.Fatal(err)
	}
	previous := database.DB
	database.DB = sqlx.NewDb(raw, "mysql")
	defer func() { database.DB = previous }()
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.POST("/signup", Signup)
	router.POST("/google-signup", SignupWithGoogleAuth)
	signup := func(path, authID, mode string) int {
		t.Helper()
		body := map[string]string{"username": "Synthetic", "auth_id": authID, "encrypted_password": "synthetic-hash"}
		if mode != "" {
			body["signup_mode"] = mode
		}
		if path == "/google-signup" {
			body["google_auth_id"] = "google-" + authID
			body["google_email"] = authID + "@example.invalid"
			body["google_profile_image_url"] = "https://example.invalid/avatar.png"
		}
		payload, _ := json.Marshal(body)
		recorder := httptest.NewRecorder()
		req := httptest.NewRequest("POST", path, bytes.NewReader(payload))
		req.Header.Set("Content-Type", "application/json")
		router.ServeHTTP(recorder, req)
		return recorder.Code
	}
	if code := signup("/signup", "new-default", ""); code != 201 {
		t.Fatal("default v3 signup", code)
	}
	if code := signup("/signup", "new-v2-test", "v2"); code != 403 {
		t.Fatal("test v2 signup accepted", code)
	}
	if code := signup("/google-signup", "new-google", ""); code != 200 {
		t.Fatal("Google v3 signup", code)
	}
	if code := signup("/signup", "new-after-release", ""); code != 201 {
		t.Fatal("released v3 signup", code)
	}
	if code := signup("/signup", "v2-after-release", "v2"); code != 403 {
		t.Fatal("released v2 signup accepted", code)
	}
	for _, tc := range []struct {
		authID, mode string
		epoch        bool
	}{
		{"new-default", "e2ee_pending", false},
		{"new-google", "e2ee_pending", false},
		{"new-after-release", "e2ee_pending", false},
	} {
		var mode string
		var epoch sql.NullString
		err := raw.QueryRow("SELECT s.mode,s.epoch FROM sync_users s JOIN user_master u ON u.uid=s.uid WHERE u.auth_id=?", tc.authID).Scan(&mode, &epoch)
		if err != nil || mode != tc.mode || epoch.Valid != tc.epoch {
			t.Fatal("signup mode persisted incorrectly", tc.authID, mode, epoch.Valid, err)
		}
	}
	if err := raw.QueryRow("SELECT COUNT(*) FROM user_master WHERE auth_id IN ('new-v2-test','v2-after-release')").Scan(&count); err != nil || count != 0 {
		t.Fatal("blocked signup created a user", count, err)
	}
}
