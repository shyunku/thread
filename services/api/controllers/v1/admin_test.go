package v1

import (
	"github.com/gin-gonic/gin"
	"net/http/httptest"
	"testing"
)

func TestAdminSessionRequiresAuthentication(t *testing.T) {
	r := gin.New()
	UseAdminRouter(r.Group("/v1"))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest("GET", "/v1/admin/session", nil))
	if w.Code != 401 {
		t.Fatal(w.Code)
	}
}

func TestAdminGateRejectsNonAdmin(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, admin := range []bool{false, true} {
		r := gin.New()
		r.Use(func(c *gin.Context) { c.Set("is_admin", admin) })
		r.Use(AdminMiddleware)
		r.GET("/session", checkAdminSession)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest("GET", "/session", nil))
		if (admin && w.Code != 200) || (!admin && w.Code != 403) {
			t.Fatal(admin, w.Code)
		}
	}
}
