package v2

import (
	"fmt"
	"github.com/gin-gonic/gin"
	"net/http"
	"os"
)

// 0 (or an unset legacy value) keeps v2 available; 1 retires v2.
// This is captured at router registration and never alters account data.
func releaseGate() gin.HandlerFunc {
	mode := os.Getenv("E2EE_RELEASE_VERSION")
	if (mode != "" && mode != "0" && mode != "1") || (mode == "1" && os.Getenv("E2EE_API_ENABLED") != "true") {
		panic(fmt.Errorf("invalid E2EE release gate configuration"))
	}
	return func(c *gin.Context) {
		if mode != "1" {
			c.Next()
			return
		}
		c.Header("Cache-Control", "no-store")
		c.AbortWithStatusJSON(http.StatusUpgradeRequired, gin.H{"code": "UPDATE_REQUIRED", "protocolVersion": 3, "version": "1.1.3"})
	}
}
