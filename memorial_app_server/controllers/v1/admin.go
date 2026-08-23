package v1

import (
	"database/sql"
	"github.com/gin-gonic/gin"
	"memorial_app_server/log"
	"memorial_app_server/service/database"
	"net/http"
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
	// get uid from context
	uid, ok := c.Get("uid")
	if !ok {
		c.AbortWithStatus(http.StatusForbidden)
		return
	}

	var adminEntity database.AdminEntity
	if err := database.DB.QueryRowx("SELECT * FROM admin_master WHERE uid = ?", uid).StructScan(&adminEntity); err != nil {
		if err == sql.ErrNoRows {
			// user not found
			c.AbortWithStatus(http.StatusForbidden)
			return
		}
		log.Error(err)
		c.AbortWithStatus(http.StatusInternalServerError)
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
