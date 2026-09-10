package v2

import (
	"fmt"
	"github.com/gin-gonic/gin"
	"net/http"
	"os"
	"regexp"
)

var releaseVersion = regexp.MustCompile(`^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$`)

// Empty means pre-release: leave the existing API unchanged. This is captured
// at router registration and does not migrate, delete or alter account data.
func releaseGate() gin.HandlerFunc {
	version := os.Getenv("E2EE_RELEASE_VERSION")
	if version != "" && (len(version) > 64 || !releaseVersion.MatchString(version) || os.Getenv("E2EE_API_ENABLED") != "true") {
		panic(fmt.Errorf("invalid E2EE release gate configuration"))
	}
	return func(c *gin.Context) {
		if version == "" {
			c.Next()
			return
		}
		c.Header("Cache-Control", "no-store")
		c.AbortWithStatusJSON(http.StatusUpgradeRequired, gin.H{"code": "UPDATE_REQUIRED", "protocolVersion": 3, "version": version})
	}
}
