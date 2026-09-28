package v1

import (
	"database/sql"
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"thread_api/service/database"
)

func signupMode(requested string) (string, error) {
	if requested != "" {
		return "", errors.New("invalid signup mode")
	}
	return "e2ee_pending", nil
}

func signupModeError(c *gin.Context, err error) {
	c.JSON(http.StatusBadRequest, gin.H{"code": "INVALID_SIGNUP_MODE"})
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
