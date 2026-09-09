package controllers

import (
	"fmt"
	"io"
	"time"

	"github.com/gin-gonic/gin"
)

// Log only server-owned route templates. Raw URLs, query parameters, headers,
// request/response bodies, errors and panic values can contain private data.
func privateRequestLog(out io.Writer) gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		c.Next()
		route := c.FullPath()
		if route == "" {
			route = "<unmatched>"
		}
		method := c.Request.Method
		switch method {
		case "GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS":
		default:
			method = "OTHER"
		}
		fmt.Fprintf(out, "[HTTP] %s %s %d %dms\n", method, route, c.Writer.Status(), time.Since(start).Milliseconds())
	}
}

func privateRecovery() gin.HandlerFunc {
	return func(c *gin.Context) {
		defer func() {
			if recover() != nil {
				c.AbortWithStatusJSON(500, gin.H{"code": "INTERNAL_ERROR"})
			}
		}()
		c.Next()
	}
}
