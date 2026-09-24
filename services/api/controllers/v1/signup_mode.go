package v1

import (
	"database/sql"
	"errors"
	"net/http"
	"os"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"thread_api/service/database"
)

var errV2SignupDisabled = errors.New("v2 test signup disabled")
var errV3APIDisabled = errors.New("v3 API disabled")

func signupMode(requested string) (string, error) {
	switch requested {
	case "":
		if os.Getenv("E2EE_API_ENABLED") != "true" {
			return "", errV3APIDisabled
		}
		return "e2ee_pending", nil
	case "v2":
		if os.Getenv("E2EE_RELEASE_VERSION") == "1" {
			return "", errV2SignupDisabled
		}
		return "v2", nil
	default:
		return "", errors.New("invalid signup mode")
	}
}

func signupModeError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, errV2SignupDisabled):
		c.JSON(http.StatusForbidden, gin.H{"code": "V2_SIGNUP_DISABLED"})
	case errors.Is(err, errV3APIDisabled):
		c.JSON(http.StatusServiceUnavailable, gin.H{"code": "E2EE_API_DISABLED"})
	default:
		c.JSON(http.StatusBadRequest, gin.H{"code": "INVALID_SIGNUP_MODE"})
	}
}

func createSignupUser(c *gin.Context, uid, mode, query string, args ...interface{}) error {
	tx, err := database.DB.BeginTxx(c.Request.Context(), &sql.TxOptions{})
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(c.Request.Context(), query, args...); err != nil {
		return err
	}
	var epoch interface{}
	if mode == "v2" {
		epoch = uuid.New().String()
	}
	if _, err = tx.ExecContext(c.Request.Context(), "INSERT INTO sync_users(uid,mode,epoch) VALUES (?,?,?)", uid, mode, epoch); err != nil {
		return err
	}
	return tx.Commit()
}

func SignupOptions(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, gin.H{"v2TestSignupAvailable": os.Getenv("E2EE_RELEASE_VERSION") != "1"})
}
