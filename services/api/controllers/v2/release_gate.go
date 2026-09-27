package v2

import (
	"github.com/gin-gonic/gin"
	"net/http"
)

// v2 sync is retired. Keep the explicit upgrade response for older clients.
func releaseGate() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("Cache-Control", "no-store")
		c.AbortWithStatusJSON(http.StatusUpgradeRequired, gin.H{"code": "UPDATE_REQUIRED", "protocolVersion": 3, "version": "1.1.3"})
	}
}
