package controllers

import (
	"bytes"
	"errors"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestPrivateRequestLogsExcludeUntrustedData(t *testing.T) {
	gin.SetMode(gin.TestMode)
	var log bytes.Buffer
	r := gin.New()
	r.Use(privateRequestLog(&log), privateRecovery())
	r.POST("/test/:id", func(c *gin.Context) {
		_ = c.Error(errors.New("PRIVATE_ERROR"))
		panic("PRIVATE_PANIC")
	})
	request := httptest.NewRequest("POST", "/test/PRIVATE_PATH?code=PRIVATE_CODE", strings.NewReader("PRIVATE_BODY"))
	request.Header.Set("Authorization", "Bearer PRIVATE_TOKEN")
	request.Header.Set("Cookie", "session=PRIVATE_COOKIE")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, request)
	if w.Code != 500 || !strings.Contains(w.Body.String(), "INTERNAL_ERROR") {
		t.Fatalf("unexpected panic response: %d", w.Code)
	}
	r.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("PRIVATE_METHOD", "/PRIVATE_UNMATCHED", nil))
	if strings.Contains(log.String()+w.Body.String(), "PRIVATE_") {
		t.Fatal("private input escaped into diagnostics")
	}
	if !strings.Contains(log.String(), "POST /test/:id 500") || !strings.Contains(log.String(), "OTHER <unmatched> 404") {
		t.Fatal("missing sanitized diagnostic metadata")
	}
}
