package main

import (
	"github.com/joho/godotenv"
	"memorial_app_server/controllers"
	"memorial_app_server/libs/crypto"
	"memorial_app_server/log"
	"memorial_app_server/service/database"
	"memorial_app_server/service/state"
	"os"
	"strconv"
	"strings"
)

const VERSION = "1.0.1"

var DebugMode = false

func main() {
	log.Infof("Starting Memorial App Server v%s...", VERSION)

	// Create Jwt secret key if needed
	//crypto.PrintNewJwtSecret()

	// Load environment variables
	log.Info("Initializing environments...")
	if err := godotenv.Load(); err != nil {
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
		"JWT_ACCESS_EXPIRE",
		"JWT_REFRESH_SECRET",
		"JWT_REFRESH_EXPIRE",
		"STATE_SCHEME_VERSION",
		"DEBUG",
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

	// Setting extra environment variables
	// debug
	debug := os.Getenv("DEBUG")
	if debug == "true" {
		DebugMode = true
		log.Info("debug mode activated")
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
	controllers.RunGin(DebugMode)
}
