package v1

import (
	"github.com/gin-gonic/gin"
	"net/http"
)

func testToken(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"message": "test",
	})
}

func UseTokenRouter(g *gin.RouterGroup) {
	sg := g.Group("/token")
	sg.Use(AuthMiddleware)
	sg.POST("/test", testToken)
}
