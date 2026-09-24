package v1

import (
	"encoding/json"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestSignupModeReleaseGate(t *testing.T) {
	t.Setenv("E2EE_API_ENABLED", "true")
	for _, version := range []string{"", "0", "1"} {
		t.Run("release_"+version, func(t *testing.T) {
			t.Setenv("E2EE_RELEASE_VERSION", version)
			if mode, err := signupMode(""); err != nil || mode != "e2ee_pending" {
				t.Fatalf("default signup must be v3: %q %v", mode, err)
			}
			mode, err := signupMode("v2")
			if version != "1" && (err != nil || mode != "v2") {
				t.Fatalf("v2 test signup must be available before release: %q %v", mode, err)
			}
			if version == "1" && err == nil {
				t.Fatal("v2 test signup accepted after release")
			}
		})
	}
	if _, err := signupMode("legacy"); err == nil {
		t.Fatal("unknown signup mode accepted")
	}
	t.Setenv("E2EE_API_ENABLED", "false")
	if _, err := signupMode(""); err == nil {
		t.Fatal("v3 account created without v3 API")
	}
}

func TestSignupOptionsMatchesReleaseGate(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, tc := range []struct {
		version string
		want    bool
	}{{"", true}, {"0", true}, {"1", false}} {
		t.Setenv("E2EE_RELEASE_VERSION", tc.version)
		router := gin.New()
		router.GET("/signup-options", SignupOptions)
		result := httptest.NewRecorder()
		router.ServeHTTP(result, httptest.NewRequest("GET", "/signup-options", nil))
		var body struct {
			Available bool `json:"v2TestSignupAvailable"`
		}
		if result.Code != 200 || json.Unmarshal(result.Body.Bytes(), &body) != nil ||
			body.Available != tc.want || result.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("signup options for %q: %d %s", tc.version, result.Code, result.Body.String())
		}
	}
}
