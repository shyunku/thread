package v1

import (
	"github.com/gin-gonic/gin"
	"net/http/httptest"
	"strings"
	"testing"
	"thread_api/service/releasealerts"
)

func TestReleaseAlertAdminGate(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, admin := range []bool{false, true} {
		r := gin.New()
		r.Use(func(c *gin.Context) { c.Set("is_admin", admin) })
		r.Use(AdminMiddleware)
		r.POST("/alert", alertNewVersion)
		ch, unsubscribe := releasealerts.Subscribe()
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest("POST", "/alert", strings.NewReader(`{"version":"2.0.0"}`)))
		if admin {
			if w.Code != 200 {
				t.Fatal(w.Code, w.Body.String())
			}
			select {
			case event := <-ch:
				if event.Version != "2.0.0" {
					t.Fatal(event)
				}
			default:
				t.Fatal("no websocket event")
			}
		} else if w.Code != 403 {
			t.Fatal("non-admin accepted", w.Code)
		}
		unsubscribe()
	}
}

func TestReleaseAlertRejectsMalformedVersion(t *testing.T) {
	r := gin.New()
	r.POST("/alert", alertNewVersion)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest("POST", "/alert", strings.NewReader(`{"version":"../../bad"}`)))
	if w.Code != 400 {
		t.Fatal(w.Code)
	}
}

func TestAdminSessionRequiresAuthentication(t *testing.T) {
	r := gin.New()
	UseAdminRouter(r.Group("/v1"))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest("GET", "/v1/admin/session", nil))
	if w.Code != 401 {
		t.Fatal(w.Code)
	}
}
