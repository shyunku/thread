package v1

import (
	"database/sql"
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"thread_api/service/database"
)

var errV2SignupDisabled = errors.New("v2 test signup disabled")

func signupMode(requested string) (string, error) {
	switch requested {
	case "":
		return "e2ee_pending", nil
	case "v2":
		return "", errV2SignupDisabled
	default:
		return "", errors.New("invalid signup mode")
	}
}

func signupModeError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, errV2SignupDisabled):
		c.JSON(http.StatusForbidden, gin.H{"code": "V2_SIGNUP_DISABLED"})
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
	if _, err = tx.ExecContext(c.Request.Context(), "INSERT INTO sync_users(uid,mode,epoch) VALUES (?,?,NULL)", uid, mode); err != nil {
		return err
	}
	return tx.Commit()
}
