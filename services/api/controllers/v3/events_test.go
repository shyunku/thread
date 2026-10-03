package v3

import (
	"bufio"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"thread_api/service/syncevents"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt"
)

func TestSyncEventsStreamSignalsChanges(t *testing.T) {
	gin.SetMode(gin.TestMode)
	secret := []byte(strings.Repeat("s", 32))
	broker := syncevents.NewBroker()
	r := gin.New()
	RegisterSyncEvents(r, broker, secret)
	server := httptest.NewServer(r)
	defer server.Close()
	token, _ := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"uid": "user-1", "admin": false, "authorized": true, "exp": time.Now().Unix() + 60,
	}).SignedString(secret)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, "GET", server.URL+"/v3/sync/events", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 || resp.Header.Get("Content-Type") != "text/event-stream" {
		t.Fatalf("stream: %d %s", resp.StatusCode, resp.Header.Get("Content-Type"))
	}
	lines := bufio.NewScanner(resp.Body)
	next := func() string {
		for lines.Scan() {
			if line := lines.Text(); strings.HasPrefix(line, "event:") {
				return line
			}
		}
		t.Fatal("stream ended")
		return ""
	}
	// An initial signal so a reconnecting device catches up.
	if got := next(); got != "event: changed" {
		t.Fatalf("first event: %q", got)
	}
	for i := 0; i < 50 && broker.Subscribers("user-1") == 0; i++ {
		time.Sleep(10 * time.Millisecond)
	}
	broker.Notify("user-2") // another account: nothing
	broker.Notify("user-1")
	if got := next(); got != "event: changed" {
		t.Fatalf("change event: %q", got)
	}
	cancel()
	for i := 0; i < 50 && broker.Subscribers("user-1") != 0; i++ {
		time.Sleep(10 * time.Millisecond)
	}
	if broker.Subscribers("user-1") != 0 {
		t.Fatal("subscription leaked after disconnect")
	}

	unauth := httptest.NewRecorder()
	r.ServeHTTP(unauth, httptest.NewRequest("GET", "/v3/sync/events", nil))
	if unauth.Code != 401 {
		t.Fatalf("unauthenticated stream: %d", unauth.Code)
	}
}

func TestBrokerCoalescesSignals(t *testing.T) {
	broker := syncevents.NewBroker()
	signals, cancel := broker.Subscribe("u")
	broker.Notify("u")
	broker.Notify("u")
	<-signals
	select {
	case <-signals:
		t.Fatal("signals should coalesce")
	default:
	}
	cancel()
	if broker.Subscribers("u") != 0 {
		t.Fatal("cancel did not unsubscribe")
	}
}
