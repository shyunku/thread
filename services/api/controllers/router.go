package controllers

import (
	"fmt"
	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"os"
	"thread_api/configs"
	"thread_api/controllers/v1"
	"thread_api/controllers/v3"
	"thread_api/log"
	"thread_api/service/pairing"
	"thread_api/service/session"
)

func ping(c *gin.Context) {
	c.String(200, "pong")
}

// UseSessions connects the login session store to every authenticated route.
func UseSessions(store session.Store) {
	v1.Sessions = store
	v3.SetSessionVerifier(store)
}

// UsePairing connects the device-connection relay store.
func UsePairing(store pairing.Store) {
	v3.SetPairingStore(store)
}

func SetupRouter() *gin.Engine {
	gin.DefaultWriter = &log.GlobalLogger
	gin.DefaultErrorWriter = &log.GlobalLogger

	// initialize oauth
	v1.InitializeGoogleOauth()

	// setting cors
	config := cors.DefaultConfig()
	config.AllowOrigins = []string{"*"}
	config.AllowHeaders = append(config.AllowHeaders, "Authorization")

	r := gin.New()
	r.Use(privateRequestLog(gin.DefaultWriter), privateRecovery())
	r.Use(cors.New(config))
	r.GET("/ping", ping)

	v1.UseRouterV1(r)
	v3.UseRouter(r)
	return r
}

func RunGin(useHTTPS bool) {
	log.Infof("Starting server on port on %d...", configs.AppServerPort)
	r := SetupRouter()

	if useHTTPS {
		if err := r.RunTLS(
			fmt.Sprintf(":%d", configs.AppServerPort),
			"certificates/cert.pem",
			"certificates/key.pem"); err != nil {
			log.Fatal(err)
			os.Exit(-3)
		}
	} else {
		if err := r.Run(fmt.Sprintf(":%d", configs.AppServerPort)); err != nil {
			log.Fatal(err)
			os.Exit(-3)
		}
	}
}
