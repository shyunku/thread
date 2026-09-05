package v2

import (
	"bytes"
	"encoding/json"
	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"thread_api/service/canonical"
	"time"
)

func TestSyncAuthentication(t *testing.T) {
	gin.SetMode(gin.TestMode)
	secret := []byte(strings.Repeat("s", 32))
	token := func(method jwt.SigningMethod, claims jwt.MapClaims) string {
		v, e := jwt.NewWithClaims(method, claims).SignedString(secret)
		if e != nil {
			t.Fatal(e)
		}
		return v
	}
	claims := func() jwt.MapClaims {
		return jwt.MapClaims{"uid": "fixture", "exp": time.Now().Add(time.Hour).Unix(), "authorized": true}
	}
	for _, tc := range []struct {
		name   string
		token  string
		status int
	}{
		{"missing", "", 401},
		{"wrong algorithm", token(jwt.SigningMethodHS384, claims()), 401},
		{"wrong uid type", token(jwt.SigningMethodHS256, jwt.MapClaims{"uid": 12, "exp": time.Now().Add(time.Hour).Unix(), "authorized": true}), 403},
		{"refresh rejected", token(jwt.SigningMethodHS256, jwt.MapClaims{"uid": "fixture", "exp": time.Now().Add(time.Hour).Unix()}), 401},
		{"missing expiry", token(jwt.SigningMethodHS256, jwt.MapClaims{"uid": "fixture", "authorized": true}), 401},
		{"expired", token(jwt.SigningMethodHS256, jwt.MapClaims{"uid": "fixture", "exp": 1, "authorized": true}), 401},
		{"admin", token(jwt.SigningMethodHS256, jwt.MapClaims{"uid": "fixture", "admin": true, "exp": time.Now().Add(time.Hour).Unix(), "authorized": true}), 403},
		{"disabled", token(jwt.SigningMethodHS256, claims()), 503},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := gin.New()
			Register(r, &canonical.Protocol{}, secret)
			req := httptest.NewRequest("GET", "/v2/sync/changes", nil)
			if tc.token != "" {
				req.Header.Set("Authorization", "Bearer "+tc.token)
			}
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)
			if w.Code != tc.status {
				t.Fatal(w.Code, w.Body.String())
			}
		})
	}
}
func TestBoundedStrictBody(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, raw := range []string{`{"epoch":"ok","uid":"spoof"}`, `{"epoch":"ok"} {}`, strings.Repeat("x", 1024*1024+1), `null null`} {
		r := gin.New()
		r.POST("/", func(c *gin.Context) {
			var b struct {
				Epoch string `json:"epoch"`
			}
			if body(c, &b) {
				c.Status(200)
			}
		})
		req := httptest.NewRequest(http.MethodPost, "/", bytes.NewBufferString(raw))
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != 400 {
			t.Fatal(w.Code)
		}
	}
	r := gin.New()
	r.POST("/", func(c *gin.Context) {
		var b map[string]interface{}
		if body(c, &b) {
			if _, ok := b["n"].(json.Number); !ok {
				t.Fatal("number precision lost")
			}
			c.Status(200)
		}
	})
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest("POST", "/", strings.NewReader(`{"n":9007199254740993}`)))
	if w.Code != 200 {
		t.Fatal(w.Code)
	}
}
