package v1

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"os"
	"thread_api/log"
	"thread_api/service/database"
	"thread_api/service/session"
	"thread_api/util"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt"
	"github.com/google/uuid"
)

// Sessions holds login sessions. It must be set before the router serves requests.
var Sessions session.Store

var errSessionsUnavailable = errors.New("session store not configured")

// sessionNow is replaced in tests to step past the reuse grace window.
var sessionNow = time.Now

func sessionTTL(token authToken) time.Duration {
	return time.Until(time.Unix(token.ExpiresAt, 0))
}

// issueSession starts a new login session and returns its first token pair.
func issueSession(ctx context.Context, uid string, isAdmin bool) (*authTokenDto, error) {
	if Sessions == nil {
		return nil, errSessionsUnavailable
	}
	sid := uuid.New().String()
	auth, err := createAuthTokenWithRole(uid, isAdmin, sid)
	if err != nil {
		return nil, err
	}
	info := session.Info{UID: uid, SID: sid}
	if err := Sessions.Create(ctx, info, session.Hash(auth.RefreshToken.Token), sessionTTL(auth.RefreshToken)); err != nil {
		return nil, err
	}
	return auth, nil
}

// refreshTokenSubject verifies a refresh token's signature and expiry and returns its uid.
func refreshTokenSubject(raw string) (string, bool) {
	if raw == "" || len(raw) > 8192 {
		return "", false
	}
	secret := os.Getenv("JWT_REFRESH_SECRET")
	token, err := jwt.Parse(raw, func(t *jwt.Token) (interface{}, error) {
		if t.Method != jwt.SigningMethodHS256 {
			return nil, errors.New("invalid algorithm")
		}
		return []byte(secret), nil
	})
	if secret == "" || err != nil || token == nil || !token.Valid {
		return "", false
	}
	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return "", false
	}
	uid, ok := claims["uid"].(string)
	return uid, ok && uid != ""
}

// accountExists rejects refreshes for deleted accounts.
func accountExists(uid string) (bool, error) {
	if uid == adminTokenSubject {
		return true, nil
	}
	var userEntity database.UserEntity
	err := database.DB.QueryRowx("SELECT * FROM user_master WHERE uid = ?", uid).StructScan(&userEntity)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}

func unauthorized(c *gin.Context, code string) {
	c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"code": code})
}

func sessionUnavailable(c *gin.Context, err error) {
	log.Error(err)
	c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{"code": "SESSION_UNAVAILABLE"})
}

// RefreshToken exchanges a refresh token for a new pair and retires the old one.
func RefreshToken(c *gin.Context) {
	raw := c.GetHeader("X-Refresh-Token")
	if raw == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "refresh token not found"})
		return
	}
	if Sessions == nil {
		sessionUnavailable(c, errSessionsUnavailable)
		return
	}
	uid, ok := refreshTokenSubject(raw)
	if !ok {
		unauthorized(c, "INVALID_REFRESH_TOKEN")
		return
	}
	if exists, err := accountExists(uid); err != nil {
		log.Error(err)
		c.AbortWithStatus(http.StatusInternalServerError)
		return
	} else if !exists {
		unauthorized(c, "INVALID_REFRESH_TOKEN")
		return
	}

	ctx := c.Request.Context()
	hash := session.Hash(raw)
	info, _, err := Sessions.Resolve(ctx, hash)
	switch {
	case err == nil:
		if info.UID != uid {
			unauthorized(c, "INVALID_REFRESH_TOKEN")
			return
		}
		auth, err := createAuthTokenWithRole(info.UID, info.UID == adminTokenSubject, info.SID)
		if err != nil {
			log.Error(err)
			c.AbortWithStatus(http.StatusInternalServerError)
			return
		}
		err = Sessions.Rotate(ctx, info, hash, session.Hash(auth.RefreshToken.Token), sessionTTL(auth.RefreshToken), sessionNow())
		switch {
		case err == nil:
			c.JSON(http.StatusOK, auth)
		case errors.Is(err, session.ErrReused):
			log.Warn("refresh token reused; session revoked")
			unauthorized(c, "REFRESH_TOKEN_REUSED")
		case errors.Is(err, session.ErrNotFound):
			unauthorized(c, "INVALID_REFRESH_TOKEN")
		default:
			sessionUnavailable(c, err)
		}
	case errors.Is(err, session.ErrNotFound):
		// A token issued before sessions were tracked becomes a session on its first refresh.
		took, err := Sessions.TakeLegacy(ctx, raw, uid)
		if err != nil {
			sessionUnavailable(c, err)
			return
		}
		if !took {
			unauthorized(c, "INVALID_REFRESH_TOKEN")
			return
		}
		auth, err := issueSession(ctx, uid, uid == adminTokenSubject)
		if err != nil {
			sessionUnavailable(c, err)
			return
		}
		c.JSON(http.StatusOK, auth)
	default:
		sessionUnavailable(c, err)
	}
}

// Logout ends the session of the given refresh token. It succeeds even if the
// token is already invalid, so clients can always clear their local state.
func Logout(c *gin.Context) {
	raw := c.GetHeader("X-Refresh-Token")
	if raw == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "refresh token not found"})
		return
	}
	if Sessions == nil {
		sessionUnavailable(c, errSessionsUnavailable)
		return
	}
	uid, ok := refreshTokenSubject(raw)
	if !ok {
		c.Status(http.StatusNoContent)
		return
	}
	ctx := c.Request.Context()
	info, _, err := Sessions.Resolve(ctx, session.Hash(raw))
	switch {
	case err == nil:
		if info.UID == uid {
			err = Sessions.Revoke(ctx, info)
		}
	case errors.Is(err, session.ErrNotFound):
		err = Sessions.DropLegacy(ctx, raw, uid)
	}
	if err != nil {
		sessionUnavailable(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

type revokeSessionsRequest struct {
	KeepCurrent bool `json:"keep_current"`
}

// RevokeSessions ends the caller's other sessions, or all of them.
func RevokeSessions(c *gin.Context) {
	var body revokeSessionsRequest
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": "INVALID_REQUEST"})
		return
	}
	uid, sid := c.GetString("uid"), c.GetString("sid")
	if body.KeepCurrent && sid == "" {
		// Tokens issued before sessions were tracked have no session to keep.
		c.AbortWithStatusJSON(http.StatusConflict, gin.H{"code": "SESSION_REFRESH_REQUIRED"})
		return
	}
	keep := ""
	if body.KeepCurrent {
		keep = sid
	}
	ttl, err := refreshLifetime()
	if err != nil {
		log.Error(err)
		c.AbortWithStatus(http.StatusInternalServerError)
		return
	}
	if err := Sessions.RevokeUser(c.Request.Context(), uid, keep, ttl); err != nil {
		sessionUnavailable(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

// refreshLifetime is how long a refresh token issued now stays valid.
func refreshLifetime() (time.Duration, error) {
	return util.ParseDuration(os.Getenv("JWT_REFRESH_EXPIRE"))
}

// checkSession rejects access tokens whose session was revoked. It reports
// whether the request may continue.
func checkSession(c *gin.Context, uid, sid string) bool {
	if Sessions == nil {
		sessionUnavailable(c, errSessionsUnavailable)
		return false
	}
	active, err := Sessions.Active(c.Request.Context(), uid, sid)
	if err != nil {
		sessionUnavailable(c, err)
		return false
	}
	if !active {
		unauthorized(c, "SESSION_REVOKED")
		return false
	}
	c.Set("sid", sid)
	return true
}
