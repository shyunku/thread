package v3

import (
	"errors"
	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt"
	"net/http"
	"strings"
	"time"
)

// UserPrincipal authorizes account lookup only, never a device mutation.
// Approval/recovery/sync routes additionally require pinned device signatures.
// Not mounted until the signed v3 protocol implementation is ready.
func UserPrincipal(secret []byte) gin.HandlerFunc {
	secret = append([]byte(nil), secret...)
	return func(c *gin.Context) {
		c.Header("Cache-Control", "no-store")
		deny := func(status int, code string) { c.AbortWithStatusJSON(status, gin.H{"code": code}) }
		parts := strings.Fields(c.GetHeader("Authorization"))
		if len(secret) < 32 || len(parts) != 2 || parts[0] != "Bearer" || len(parts[1]) > 8192 {
			deny(http.StatusUnauthorized, "UNAUTHORIZED")
			return
		}
		token, err := jwt.Parse(parts[1], func(t *jwt.Token) (interface{}, error) {
			if t.Method != jwt.SigningMethodHS256 {
				return nil, errors.New("invalid algorithm")
			}
			return secret, nil
		})
		if err != nil || token == nil || !token.Valid {
			deny(http.StatusUnauthorized, "UNAUTHORIZED")
			return
		}
		claims, ok := token.Claims.(jwt.MapClaims)
		if !ok || claims["authorized"] != true || !claims.VerifyExpiresAt(time.Now().Unix(), true) {
			deny(http.StatusUnauthorized, "UNAUTHORIZED")
			return
		}
		uid, ok := claims["uid"].(string)
		if !ok || uid == "" || len(uid) > 255 || strings.TrimSpace(uid) != uid || uid == "__thread_env_admin__" || claims["admin"] != false {
			deny(http.StatusForbidden, "USER_REQUIRED")
			return
		}
		c.Set("uid", uid)
		c.Next()
	}
}
