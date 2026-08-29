package v1

import "testing"

func TestHashAdminCredentialsMatchesWebClient(t *testing.T) {
	const expected = "c459b14225f025beb097c4477746bfda9b3d531d859396a3d3180d4eb471145b"
	if actual := hashAdminCredentials("admin", "password"); actual != expected {
		t.Fatalf("unexpected credential hash: %s", actual)
	}
}

func TestValidateAdminCredentials(t *testing.T) {
	t.Setenv("ADMIN_ID", "admin")
	t.Setenv("ADMIN_PASSWORD", "password")

	valid := LoginRequestDto{
		AuthId:            "admin",
		EncryptedPassword: hashAdminCredentials("admin", "password"),
	}
	if !validateAdminCredentials(valid) {
		t.Fatal("expected valid administrator credentials")
	}

	wrongId := valid
	wrongId.AuthId = "other-admin"
	if validateAdminCredentials(wrongId) {
		t.Fatal("expected administrator ID mismatch")
	}

	wrongPassword := valid
	wrongPassword.EncryptedPassword = hashAdminCredentials("admin", "wrong-password")
	if validateAdminCredentials(wrongPassword) {
		t.Fatal("expected administrator password mismatch")
	}
}

func TestValidateAdminCredentialsRejectsMissingEnvironment(t *testing.T) {
	t.Setenv("ADMIN_ID", "")
	t.Setenv("ADMIN_PASSWORD", "")

	if validateAdminCredentials(LoginRequestDto{
		AuthId:            "admin",
		EncryptedPassword: hashAdminCredentials("admin", "password"),
	}) {
		t.Fatal("expected missing environment configuration to be rejected")
	}
}
