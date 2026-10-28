package v1

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"thread_api/log"
	"time"

	"github.com/gin-gonic/gin"
)

// AccountDeleter removes an account and all of its data in one transaction.
// Deleting an account that is already gone must succeed.
type AccountDeleter interface {
	Delete(ctx context.Context, uid string) error
}

var (
	// Accounts deletes accounts. Without it the delete route answers 503.
	Accounts AccountDeleter
	// DeleteAccountPairing removes the account's pairing session (Redis).
	DeleteAccountPairing = func(context.Context, string) error { return nil }
	// CloseAccountStreams ends the account's open sync event streams.
	CloseAccountStreams = func(string) {}
)

var errNotObject = errors.New("request body is not a JSON object")

const (
	accountDeleteTimeout = 30 * time.Second
	maxAccountDeleteBody = 1024
)

// DeleteAccount deletes the caller's account immediately and for good: the
// account, every encrypted object, its devices and all of its sessions. The
// device confirms the user before calling, so the session is the only proof.
func DeleteAccount(c *gin.Context) {
	uid := c.GetString("uid")
	if uid == "" || uid == adminTokenSubject || c.GetBool("is_admin") {
		c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"code": "USER_REQUIRED"})
		return
	}
	// No body is needed; an empty JSON object is accepted.
	if c.Request.Body != nil {
		raw, err := io.ReadAll(http.MaxBytesReader(c.Writer, c.Request.Body, maxAccountDeleteBody))
		if err == nil && len(bytes.TrimSpace(raw)) > 0 {
			var body map[string]json.RawMessage
			if err = json.Unmarshal(raw, &body); err == nil && body == nil {
				err = errNotObject
			}
		}
		if err != nil {
			c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"code": "INVALID_REQUEST"})
			return
		}
	}
	// Sessions must be revocable before anything is deleted.
	if Sessions == nil {
		sessionUnavailable(c, errSessionsUnavailable)
		return
	}
	if Accounts == nil {
		c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{"code": "DELETE_UNAVAILABLE"})
		return
	}
	ttl, err := refreshLifetime()
	if err != nil {
		log.Error(err)
		c.AbortWithStatus(http.StatusInternalServerError)
		return
	}

	// A dropped connection must not stop the work between the database commit
	// and the session revocation.
	ctx, cancel := context.WithTimeout(context.Background(), accountDeleteTimeout)
	defer cancel()
	if err := Accounts.Delete(ctx, uid); err != nil {
		log.Error(err)
		c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{"code": "DELETE_UNAVAILABLE"})
		return
	}
	// The account is gone. If a step below fails the client retries with the
	// same session; the delete above then finds nothing left and succeeds.
	if err := DeleteAccountPairing(ctx, uid); err != nil {
		sessionUnavailable(c, err)
		return
	}
	if err := Sessions.RevokeUser(ctx, uid, "", ttl); err != nil {
		sessionUnavailable(c, err)
		return
	}
	CloseAccountStreams(uid)
	c.Status(http.StatusNoContent)
}
