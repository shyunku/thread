package v3

import (
	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestUserPrincipal(t *testing.T) {
	gin.SetMode(gin.TestMode)
	secret := []byte(strings.Repeat("s", 32))
	tests := []struct {
		name   string
		change func(jwt.MapClaims)
		method jwt.SigningMethod
		want   int
	}{
		{"user", func(jwt.MapClaims) {}, jwt.SigningMethodHS256, 200},
		{"admin", func(c jwt.MapClaims) { c["admin"] = true }, jwt.SigningMethodHS256, 403},
		{"reserved subject", func(c jwt.MapClaims) { c["uid"] = "__thread_env_admin__" }, jwt.SigningMethodHS256, 403},
		{"missing role", func(c jwt.MapClaims) { delete(c, "admin") }, jwt.SigningMethodHS256, 403},
		{"string role", func(c jwt.MapClaims) { c["admin"] = "false" }, jwt.SigningMethodHS256, 403},
		{"missing uid", func(c jwt.MapClaims) { delete(c, "uid") }, jwt.SigningMethodHS256, 403},
		{"no expiry", func(c jwt.MapClaims) { delete(c, "exp") }, jwt.SigningMethodHS256, 401},
		{"expired", func(c jwt.MapClaims) { c["exp"] = time.Now().Unix() - 60 }, jwt.SigningMethodHS256, 401},
		{"unauthorized", func(c jwt.MapClaims) { c["authorized"] = false }, jwt.SigningMethodHS256, 401},
		{"wrong algorithm", func(jwt.MapClaims) {}, jwt.SigningMethodHS384, 401},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			claims := jwt.MapClaims{"uid": "fixture-user", "admin": false, "authorized": true, "exp": time.Now().Unix() + 60}
			tc.change(claims)
			token, err := jwt.NewWithClaims(tc.method, claims).SignedString(secret)
			if err != nil {
				t.Fatal(err)
			}
			r := gin.New()
			r.Use(UserPrincipal(secret))
			r.POST("/", func(c *gin.Context) { c.String(200, c.GetString("uid")) })
			req := httptest.NewRequest("POST", "/?accountId=attacker", strings.NewReader(`{"accountId":"attacker"}`))
			req.Header.Set("Authorization", "Bearer "+token)
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)
			if w.Code != tc.want {
				t.Fatalf("status %d, expected %d", w.Code, tc.want)
			}
			if w.Code == 200 && w.Body.String() != "fixture-user" {
				t.Fatal("untrusted body selected principal")
			}
			if w.Header().Get("Cache-Control") != "no-store" {
				t.Fatal("missing no-store")
			}
		})
	}
}
func TestRejectInvalidCredentials(t *testing.T) {
	for _, secret := range [][]byte{nil, []byte(strings.Repeat("s", 32))} {
		for _, header := range []string{"", "Bearer bad", "Bearer " + strings.Repeat("x", 8193)} {
			r := gin.New()
			r.Use(UserPrincipal(secret))
			r.GET("/", func(c *gin.Context) { c.Status(200) })
			req := httptest.NewRequest("GET", "/", nil)
			req.Header.Set("Authorization", header)
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)
			if w.Code != 401 {
				t.Fatal("invalid credentials accepted")
			}
		}
	}
}
