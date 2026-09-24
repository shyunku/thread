package v2

import (
	"github.com/gin-gonic/gin"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestReleaseGatePreservesPreReleaseAndRetiresOnlyV2(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, version := range []string{"", "0", "1"} {
		t.Run("release="+version, func(t *testing.T) {
			t.Setenv("E2EE_RELEASE_VERSION", version)
			t.Setenv("E2EE_API_ENABLED", "true")
			r := gin.New()
			calls := 0
			g := r.Group("/v2/sync")
			g.Use(releaseGate())
			for _, path := range []string{"/capabilities", "/push", "/snapshots", "/connect"} {
				g.Any(path, func(c *gin.Context) { calls++; c.Status(204) })
			}
			r.GET("/v3/vault/status", func(c *gin.Context) { c.Status(204) })
			r.POST("/v1/auth/login", func(c *gin.Context) { c.Status(204) })
			for _, path := range []string{"/capabilities", "/push", "/snapshots", "/connect"} {
				w := httptest.NewRecorder()
				r.ServeHTTP(w, httptest.NewRequest("POST", "/v2/sync"+path, nil))
				if version != "1" {
					if w.Code != 204 {
						t.Fatal(w.Code)
					}
				} else {
					if w.Code != http.StatusUpgradeRequired || !strings.Contains(w.Body.String(), `"version":"1.1.3"`) || w.Header().Get("Cache-Control") != "no-store" {
						t.Fatal(w.Code, w.Body.String())
					}
				}
			}
			if version == "1" && calls != 0 {
				t.Fatal("legacy handler reached")
			}
			for _, route := range []struct{ method, path string }{{"GET", "/v3/vault/status"}, {"POST", "/v1/auth/login"}} {
				w := httptest.NewRecorder()
				r.ServeHTTP(w, httptest.NewRequest(route.method, route.path, nil))
				if w.Code != 204 {
					t.Fatal("unrelated route blocked")
				}
			}
		})
	}
}
func TestReleaseGateRejectsBrokenDeploymentConfiguration(t *testing.T) {
	for _, version := range []string{"bad", "1.1.3", "2", "1\n", "../../installer"} {
		t.Run(version, func(t *testing.T) {
			t.Setenv("E2EE_RELEASE_VERSION", version)
			t.Setenv("E2EE_API_ENABLED", "true")
			defer func() {
				if recover() == nil {
					t.Fatal("invalid version accepted")
				}
			}()
			releaseGate()
		})
	}
	t.Setenv("E2EE_RELEASE_VERSION", "1")
	t.Setenv("E2EE_API_ENABLED", "false")
	defer func() {
		if recover() == nil {
			t.Fatal("disabled v3 accepted")
		}
	}()
	releaseGate()
}
