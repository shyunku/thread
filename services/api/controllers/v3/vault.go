package v3

import (
	"context"
	"errors"
	"github.com/gin-gonic/gin"
	"io"
	"mime"
	"net/http"
	"strconv"
	"thread_api/service/vault"
)

type VaultStore interface {
	Create(context.Context, string, []byte) (vault.Head, error)
	ApplyPending(context.Context, string, []byte) (vault.Head, error)
	Read(context.Context, string, uint64) (vault.Page, error)
	RecoverPending(context.Context, string, []byte) (vault.Head, error)
	ApplyTransition(context.Context, string, []byte) (vault.Head, error)
}

// Registered only behind E2EE_API_ENABLED. This never activates a pending vault.
// Active membership changes require the rotation protocol.
func RegisterPending(r *gin.Engine, s VaultStore, secret []byte) {
	g := r.Group("/v3/vault")
	g.Use(UserPrincipal(secret))
	respond := func(c *gin.Context, value interface{}, err error) {
		if err == nil {
			c.JSON(200, value)
			return
		}
		status, code := 500, "VAULT_UNAVAILABLE"
		switch {
		case errors.Is(err, vault.ErrInvalid):
			status, code = 400, "INVALID_SIGNED_RECORD"
		case errors.Is(err, vault.ErrConflict):
			status, code = 409, "MEMBERSHIP_CONFLICT"
		case errors.Is(err, vault.ErrNotFound):
			status, code = 404, "VAULT_NOT_FOUND"
		case errors.Is(err, vault.ErrForbidden):
			status, code = 403, "DEVICE_APPROVAL_FORBIDDEN"
		case errors.Is(err, vault.ErrRotationRequired):
			status, code = 409, "KEY_ROTATION_REQUIRED"
		case errors.Is(err, vault.ErrInactive):
			status, code = 409, "E2EE_NOT_ACTIVE"
		}
		c.JSON(status, gin.H{"code": code})
	}
	readBody := func(c *gin.Context) ([]byte, bool) {
		media, _, e := mime.ParseMediaType(c.GetHeader("Content-Type"))
		if e != nil || media != "application/cbor" {
			c.AbortWithStatus(415)
			return nil, false
		}
		b, e := io.ReadAll(http.MaxBytesReader(c.Writer, c.Request.Body, vault.MaxBytes))
		if e != nil {
			c.AbortWithStatus(413)
			return nil, false
		}
		return b, true
	}
	g.POST("", func(c *gin.Context) {
		b, ok := readBody(c)
		if !ok {
			return
		}
		v, e := s.Create(c.Request.Context(), c.GetString("uid"), b)
		respond(c, v, e)
	})
	g.POST("/membership", func(c *gin.Context) {
		b, ok := readBody(c)
		if !ok {
			return
		}
		v, e := s.ApplyPending(c.Request.Context(), c.GetString("uid"), b)
		respond(c, v, e)
	})
	g.POST("/recovery", func(c *gin.Context) {
		b, ok := readBody(c)
		if !ok {
			return
		}
		v, e := s.RecoverPending(c.Request.Context(), c.GetString("uid"), b)
		respond(c, v, e)
	})
	g.POST("/transition", func(c *gin.Context) {
		b, ok := readBody(c)
		if !ok {
			return
		}
		v, e := s.ApplyTransition(c.Request.Context(), c.GetString("uid"), b)
		respond(c, v, e)
	})
	g.GET("", func(c *gin.Context) {
		after := uint64(0)
		if raw := c.Query("after"); raw != "" {
			n, e := strconv.ParseUint(raw, 10, 64)
			if e != nil || strconv.FormatUint(n, 10) != raw || n > vault.MaxSafeInteger {
				respond(c, nil, vault.ErrInvalid)
				return
			}
			after = n
		}
		v, e := s.Read(c.Request.Context(), c.GetString("uid"), after)
		respond(c, v, e)
	})
}
