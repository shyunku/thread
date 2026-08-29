package controllers

import (
	"fmt"
	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"thread_api/configs"
	"thread_api/controllers/v1"
	"thread_api/log"
	"os"
)

func ping(c *gin.Context) {
	c.String(200, "pong")
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

	r := gin.Default()
	r.Use(cors.New(config))
	r.GET("/ping", ping)

	v1.UseRouterV1(r)
	return r
}

func RunGin(debugMode bool) {
	log.Infof("Starting server on port on %d...", configs.AppServerPort)
	r := SetupRouter()

	if debugMode {
		if err := r.Run(fmt.Sprintf(":%d", configs.AppServerPort)); err != nil {
			log.Fatal(err)
			os.Exit(-3)
		}
	} else {
		if err := r.RunTLS(
			fmt.Sprintf(":%d", configs.AppServerPort),
			"certificates/cert.pem",
			"certificates/key.pem"); err != nil {
			log.Fatal(err)
			os.Exit(-3)
		}
	}
}
