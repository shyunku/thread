package v1

import (
	"github.com/gin-gonic/gin"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestLegacySyncRequiresUpdateWithoutDatabase(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	UseSocketRouter(r.Group("/v1"))
	UseTestRouter(r.Group("/v1"))
	for _, path := range []string{"state", "chains", "transaction", "task", "diagram"} {
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest("GET", "/v1/test/"+path, nil))
		if w.Code != 410 {
			t.Fatal("legacy diagnostic still active", path, w.Code)
		}
	}
	for _, method := range []string{"GET", "POST"} {
		w := httptest.NewRecorder()
		req := httptest.NewRequest(method, "/v1/websocket/connect", nil)
		req.Header.Set("Authorization", "Bearer obsolete-token-must-not-be-forwarded")
		r.ServeHTTP(w, req)
		if w.Code != 426 || !strings.Contains(w.Body.String(), "UPDATE_REQUIRED") {
			t.Fatal(w.Code, w.Body.String())
		}
	}
}
