package v1

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"os"
)

const adminTokenSubject = "__thread_env_admin__"

func sha256Hex(value string) string {
	hash := sha256.Sum256([]byte(value))
	return hex.EncodeToString(hash[:])
}

func hashAdminCredentials(adminId, adminPassword string) string {
	firstHash := sha256Hex(adminId)
	secondHash := sha256Hex(firstHash + adminPassword)
	return sha256Hex(secondHash)
}

func constantTimeEqual(left, right string) bool {
	leftHash := sha256.Sum256([]byte(left))
	rightHash := sha256.Sum256([]byte(right))
	return subtle.ConstantTimeCompare(leftHash[:], rightHash[:]) == 1
}

func validateAdminCredentials(body LoginRequestDto) bool {
	adminId := os.Getenv("ADMIN_ID")
	adminPassword := os.Getenv("ADMIN_PASSWORD")
	if adminId == "" || adminPassword == "" {
		return false
	}

	expectedPassword := hashAdminCredentials(adminId, adminPassword)
	return constantTimeEqual(body.AuthId, adminId) && constantTimeEqual(body.EncryptedPassword, expectedPassword)
}
