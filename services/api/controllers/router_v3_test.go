package controllers

import (
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/jmoiron/sqlx"
	"thread_api/service/database"
)

func TestRouterHasV3SyncWithoutV2Sync(t *testing.T) {
	t.Setenv("GOOGLE_OAUTH2_CLIENT_ID", "test-client")
	t.Setenv("GOOGLE_OAUTH2_CLIENT_SECRET", "test-secret")
	t.Setenv("GOOGLE_OAUTH2_REDIRECT_URL", "http://localhost/callback")
	previous := database.DB
	database.DB = sqlx.NewDb(nil, "mysql")
	defer func() { database.DB = previous }()
	gin.SetMode(gin.TestMode)

	router := SetupRouter()
	var v3Sync bool
	for _, route := range router.Routes() {
		if strings.HasPrefix(route.Path, "/v2/") {
			t.Fatalf("retired v2 route is still registered: %s", route.Path)
		}
		if route.Path == "/v3/sync/push" {
			v3Sync = true
		}
	}
	if !v3Sync {
		t.Fatal("v3 sync route is not registered")
	}
}
