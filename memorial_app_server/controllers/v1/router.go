package v1

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt"
	"io"
	"memorial_app_server/libs/crypto"
	"memorial_app_server/log"
	"memorial_app_server/service/database"
	"net/http"
	"strings"
)

func UseRouterV1(r *gin.Engine) {
	g := r.Group("/v1")
	g.Use(DefaultMiddleware)

	UseAuthRouter(g)
	UseGoogleAuthRouter(g)
	UseAdminRouter(g)
	UseTokenRouter(g)
	UseTestRouter(g) // comment this on production
	UseSocketRouter(g)
}

func DefaultMiddleware(c *gin.Context) {
	//log.Debug(c.Request.Method, c.Request.URL.String())
	c.Next()
}

func AuthMiddleware(c *gin.Context) {
	rawToken, err := extractAuthToken(c.Request)
	if err != nil {
		c.AbortWithError(http.StatusUnauthorized, err)
		return
	}

	log.Debug("rawToken: ", rawToken)

	var unauthorizedErr error

	// check if token is valid
	token, err := jwt.Parse(rawToken, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return []byte(crypto.JwtSecretKey), nil
	})
	if err != nil {
		unauthorizedErr = err
	}

	// check if token is expired
	if unauthorizedErr == nil {
		if _, ok := token.Claims.(jwt.MapClaims); !ok || !token.Valid {
			// token expired
			unauthorizedErr = errors.New("token expired or invalid")
		}
	}

	if unauthorizedErr != nil {
		// try with Google form access token
		url := "https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=" + rawToken
		req, err := http.NewRequest("POST", url, nil)
		if err != nil {
			c.AbortWithError(http.StatusUnauthorized, unauthorizedErr)
			return
		}

		client := &http.Client{}
		resp, err := client.Do(req)
		if err != nil {
			c.AbortWithError(http.StatusUnauthorized, unauthorizedErr)
			return
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			c.AbortWithError(http.StatusUnauthorized, fmt.Errorf("auth error: %s, google auth error: %s", unauthorizedErr.Error(), resp.Status))
			return
		}

		body, err := io.ReadAll(resp.Body)
		if err != nil {
			c.AbortWithError(http.StatusInternalServerError, err)
			return
		}

		// unmarshal body
		var googleTokenInfo GoogleTokenInfo
		err = json.Unmarshal(body, &googleTokenInfo)
		if err != nil {
			c.AbortWithError(http.StatusInternalServerError, err)
			return
		}

		// find user by google auth id
		var userEntity database.UserEntity
		err = database.DB.QueryRowx("SELECT * FROM user_master WHERE google_auth_id = ?", googleTokenInfo.UserId).StructScan(&userEntity)
		if err != nil {
			if err == sql.ErrNoRows {
				c.AbortWithError(http.StatusUnauthorized, errors.New("unknown user"))
				return
			} else {
				c.AbortWithError(http.StatusInternalServerError, err)
				return
			}
		}

		c.Set("uid", *userEntity.UserId)
		c.Next()
	} else {
		claims, ok := token.Claims.(jwt.MapClaims)
		if ok && token.Valid {
			userId := claims["uid"].(string)
			c.Set("uid", userId)
			c.Next()
		} else {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid token"})
		}
	}
}

func extractAuthToken(req *http.Request) (string, error) {
	bearer := req.Header.Get("Authorization")
	token := strings.Split(bearer, " ")
	if len(token) != 2 {
		return "", errors.New("invalid token")
	}
	authToken := token[1]
	if len(authToken) == 0 {
		return "", errors.New("token empty")
	}
	return authToken, nil
}
