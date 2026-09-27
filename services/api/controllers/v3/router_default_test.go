package v3

import (
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/jmoiron/sqlx"
	"thread_api/service/database"
)

func TestV3RoutesDefaultWithoutDeploymentFlags(t *testing.T) {
	t.Setenv("E2EE_API_ENABLED", "false")
	t.Setenv("E2EE_MIGRATION_ENABLED", "true")
	previous := database.DB
	database.DB = sqlx.NewDb(nil, "mysql")
	defer func() { database.DB = previous }()
	gin.SetMode(gin.TestMode)
	router := gin.New()
	UseRouter(router)
	paths := make(map[string]bool)
	for _, route := range router.Routes() {
		paths[route.Method+" "+route.Path] = true
	}
	if !paths["GET /v3/vault/status"] || !paths["POST /v3/sync/push"] || paths["POST /v3/migration/status"] {
		t.Fatal("v3 routes not registered by default")
	}
}
