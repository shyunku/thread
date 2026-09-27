package v1

import "testing"

func TestSignupModeAlwaysV3(t *testing.T) {
	t.Setenv("E2EE_API_ENABLED", "false")
	for _, version := range []string{"", "0", "1"} {
		t.Run("release_"+version, func(t *testing.T) {
			t.Setenv("E2EE_RELEASE_VERSION", version)
			if mode, err := signupMode(""); err != nil || mode != "e2ee_pending" {
				t.Fatalf("default signup must be v3: %q %v", mode, err)
			}
			if mode, err := signupMode("v2"); err == nil || mode != "" {
				t.Fatalf("v2 signup accepted: %q %v", mode, err)
			}
		})
	}
	if _, err := signupMode("legacy"); err == nil {
		t.Fatal("unknown signup mode accepted")
	}
}
