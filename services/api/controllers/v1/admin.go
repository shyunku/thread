package v1

import (
	"github.com/gin-gonic/gin"
	"net/http"
	"thread_api/log"
	"thread_api/service/database"
)

func alertNewVersion(c *gin.Context) {

	c.JSON(http.StatusOK, gin.H{
		"message": "test",
	})
}

func onlineUserCount(c *gin.Context) {
	c.JSON(http.StatusOK, len(SocketBundles))
}

func userCount(c *gin.Context) {
	var count int
	if err := database.DB.QueryRow("SELECT COUNT(*) FROM user_master").Scan(&count); err != nil {
		log.Error(err)
		c.AbortWithStatus(http.StatusInternalServerError)
		return
	}
	c.JSON(http.StatusOK, count)
}

func AdminMiddleware(c *gin.Context) {
	rawIsAdmin, ok := c.Get("is_admin")
	if !ok {
		c.AbortWithStatus(http.StatusForbidden)
		return
	}

	isAdmin, ok := rawIsAdmin.(bool)
	if !ok || !isAdmin {
		c.AbortWithStatus(http.StatusForbidden)
		return
	}

	c.Next()
}

func UseAdminRouter(g *gin.RouterGroup) {
	sg := g.Group("/admin")
	sg.Use(AuthMiddleware)
	sg.Use(AdminMiddleware)
	sg.POST("/alert-new-version", alertNewVersion)
	sg.GET("/online-user-count", onlineUserCount)
	sg.GET("/user-count", userCount)
}
