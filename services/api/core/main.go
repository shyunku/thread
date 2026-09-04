package main

import (
	"github.com/joho/godotenv"
	"os"
	"strconv"
	"strings"
	"thread_api/controllers"
	"thread_api/libs/crypto"
	"thread_api/log"
	"thread_api/service/database"
	"thread_api/service/state"
)

const VERSION = "1.0.1"

func main() {
	log.Infof("Starting Thread App Server v%s...", VERSION)

	// Create Jwt secret key if needed
	//crypto.PrintNewJwtSecret()

	// Load environment variables
	log.Info("Initializing environments...")
	if err := godotenv.Load(); err != nil && !os.IsNotExist(err) {
		log.Error(err)
		os.Exit(-1)
	}

	// Check environment variables
	var envCheckKeys = []string{
		"GOOGLE_OAUTH2_CLIENT_ID",
		"GOOGLE_OAUTH2_CLIENT_SECRET",
		"GOOGLE_OAUTH2_REDIRECT_URL",
		"DB_USER",
		"DB_PASSWORD",
		"DB_HOST",
		"DB_PORT",
		"DB_NAME",
		"JWT_ACCESS_SECRET",
		"ADMIN_ID",
		"ADMIN_PASSWORD",
		"JWT_ACCESS_EXPIRE",
		"JWT_REFRESH_SECRET",
		"JWT_REFRESH_EXPIRE",
		"STATE_SCHEME_VERSION",
		"USE_HTTPS",
	}
	missingVariables := make([]string, 0)
	for _, key := range envCheckKeys {
		if os.Getenv(key) == "" {
			missingVariables = append(missingVariables, key)
		}
	}

	if len(missingVariables) > 0 {
		missingVarKeys := strings.Join(missingVariables, ", ")
		log.Error("Missing environment variables: ", missingVarKeys)
		os.Exit(-1)
	}

	// Decide whether the API server terminates TLS itself. Cloudflare Tunnel
	// deployments use HTTP between cloudflared and this private origin.
	useHTTPS, err := strconv.ParseBool(os.Getenv("USE_HTTPS"))
	if err != nil {
		log.Error("Invalid USE_HTTPS value: ", os.Getenv("USE_HTTPS"))
		os.Exit(-1)
	}

	// scheme version
	rawSchemeVersion := os.Getenv("STATE_SCHEME_VERSION")
	parsedSchemeVersion, err := strconv.Atoi(rawSchemeVersion)
	if err != nil {
		log.Error("Invalid scheme version: ", rawSchemeVersion)
		os.Exit(-1)
	}
	state.SchemeVersion = parsedSchemeVersion
	if state.SchemeVersion == 0 {
		panic("txType cannot be 0, maybe env is not set correctly")
	}

	// Initialize Jwt
	crypto.Initialize()

	// Initialize database
	log.Info("Initializing database...")
	if _, err := database.Initialize(); err != nil {
		log.Error(err)
		os.Exit(-2)
	}

	// Initialize in-memory database
	log.Info("Initializing in-memory database...")
	database.InMemoryDB = database.NewRedis()

	// TODO :: check redis connection

	// Initialize state service
	if err = state.InitializeService(database.DB); err != nil {
		log.Error(err)
		os.Exit(-3)
	}

	// Run web server with gin
	controllers.RunGin(useHTTPS)
}
