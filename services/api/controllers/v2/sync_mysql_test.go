package v2

import (
	"context"
	"database/sql"
	"encoding/json"
	"github.com/gin-gonic/gin"
	"github.com/go-sql-driver/mysql"
	"github.com/golang-jwt/jwt"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"thread_api/service/canonical"
	"thread_api/service/database/migrations"
	"thread_api/service/releasealerts"
	"time"
)

func TestMySQLHTTPAndWebSocket(t *testing.T) {
	dsn := os.Getenv("THREAD_SYNC_HTTP_TEST_DSN")
	if dsn == "" {
		t.Skip("explicit empty thread_sync_http_test_* DB required")
	}
	cfg, e := mysql.ParseDSN(dsn)
	if e != nil || !strings.HasPrefix(cfg.DBName, "thread_sync_http_test_") {
		t.Fatal("unsafe DB")
	}
	db, e := sql.Open("mysql", dsn)
	if e != nil {
		t.Fatal(e)
	}
	defer db.Close()
	var count int
	if e = db.QueryRow("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE()").Scan(&count); e != nil || count != 0 {
		t.Fatal("empty DB required")
	}
	for _, q := range []string{
		"CREATE TABLE user_master(uid VARCHAR(255) PRIMARY KEY) ENGINE=InnoDB",
		"CREATE TABLE transactions(txid INT,version INT,type INT,`from` VARCHAR(255),timestamp BIGINT,content BLOB,hash VARCHAR(255)) ENGINE=InnoDB",
		"CREATE TABLE blocks(uid VARCHAR(255),block_number BIGINT,state LONGBLOB,transitions LONGBLOB,tx_hash VARCHAR(255),block_hash VARCHAR(255),prev_block_hash VARCHAR(255)) ENGINE=InnoDB",
	} {
		if _, e = db.Exec(q); e != nil {
			t.Fatal(e)
		}
	}
	if _, e = migrations.Run(context.Background(), db, migrations.Server); e != nil {
		t.Fatal(e)
	}
	epoch, device := uuid.NewString(), uuid.NewString()
	if _, e = db.Exec("INSERT INTO sync_users(uid,mode,epoch) VALUES ('fixture','v2',?)", epoch); e != nil {
		t.Fatal(e)
	}
	secret := []byte(strings.Repeat("fixture-secret-", 4))
	p := &canonical.Protocol{Store: &canonical.Store{DB: db}, Key: secret, Enabled: true}
	gin.SetMode(gin.TestMode)
	router := gin.New()
	Register(router, p, secret)
	server := httptest.NewServer(router)
	defer server.Close()
	token, e := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{"uid": "fixture", "authorized": true, "exp": time.Now().Add(time.Minute).Unix()}).SignedString(secret)
	if e != nil {
		t.Fatal(e)
	}
	request := func(method, route, body string, status int, dst interface{}) {
		t.Helper()
		req, e := http.NewRequest(method, server.URL+"/v2/sync"+route, strings.NewReader(body))
		if e != nil {
			t.Fatal(e)
		}
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Content-Type", "application/json")
		client := http.Client{Timeout: 10 * time.Second}
		r, e := client.Do(req)
		if e != nil {
			t.Fatal(e)
		}
		defer r.Body.Close()
		if r.StatusCode != status {
			t.Fatalf("%s status %d", route, r.StatusCode)
		}
		if dst != nil {
			if e = json.NewDecoder(r.Body).Decode(dst); e != nil {
				t.Fatal(e)
			}
		}
	}
	var caps map[string]interface{}
	request("GET", "/capabilities", "", 200, &caps)
	if caps["mode"] != "v2" {
		t.Fatal(caps)
	}
	encoded, _ := json.Marshal(map[string]string{"epoch": epoch, "deviceId": device})
	request("POST", "/devices", string(encoded), 200, nil)
	var snap canonical.Snapshot
	encoded, _ = json.Marshal(map[string]string{"epoch": epoch})
	request("POST", "/snapshots", string(encoded), 201, &snap)
	var page canonical.SnapshotPage
	request("GET", "/snapshots/"+snap.ID+"/pages/0?epoch="+epoch, "", 200, &page)
	ws, _, e := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http")+"/v2/sync/connect?epoch="+epoch, http.Header{"Authorization": []string{"Bearer " + token}})
	if e != nil {
		t.Fatal(e)
	}
	defer ws.Close()
	ws.SetReadDeadline(time.Now().Add(10 * time.Second))
	var event map[string]interface{}
	if e = ws.ReadJSON(&event); e != nil || event["highWatermark"] != "0" {
		t.Fatal(event, e)
	}
	ws2, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http")+"/v2/sync/connect?epoch="+epoch, http.Header{"Authorization": []string{"Bearer " + token}})
	if err != nil {
		t.Fatal(err)
	}
	defer ws2.Close()
	ws2.SetReadDeadline(time.Now().Add(10 * time.Second))
	if err = ws2.ReadJSON(&event); err != nil {
		t.Fatal(err)
	}
	if releasealerts.Broadcast("2.0.0") != 2 {
		t.Fatal("expected both active sockets")
	}
	for _, peer := range []*websocket.Conn{ws, ws2} {
		if err = peer.ReadJSON(&event); err != nil || event["topic"] != "release.available" || event["version"] != "2.0.0" {
			t.Fatal("release alert missing", event, err)
		}
	}
	mutation := canonical.Mutation{ClientChangeID: uuid.NewString(), EntityType: "task", EntityID: "fixture-task", Operation: "create", BaseVersion: "0", Changes: map[string]interface{}{"title": "HTTP fixture"}}
	encoded, _ = json.Marshal(map[string]interface{}{"protocolVersion": 2, "epoch": epoch, "deviceId": device, "mutations": []canonical.Mutation{mutation}})
	var pushed struct{ Results []canonical.Result }
	request("POST", "/push", string(encoded), 200, &pushed)
	if len(pushed.Results) != 1 || pushed.Results[0].Seq != "1" {
		t.Fatal(pushed)
	}
	request("POST", "/push", string(encoded), 200, &pushed)
	if !pushed.Results[0].Duplicate {
		t.Fatal("lost ACK not idempotent")
	}
	if e = ws.ReadJSON(&event); e != nil || event["highWatermark"] != "1" {
		t.Fatal(event, e)
	}
	var changes canonical.Page
	request("GET", "/changes?epoch="+epoch+"&after="+snap.Cursor, "", 200, &changes)
	if len(changes.Entries) != 1 || changes.Entries[0].Seq != "1" {
		t.Fatal(changes)
	}
}
