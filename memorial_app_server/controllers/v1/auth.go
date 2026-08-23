package v1

import (
	"database/sql"
	"errors"
	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt"
	"github.com/google/uuid"
	"memorial_app_server/log"
	"memorial_app_server/service/database"
	"memorial_app_server/util"
	"net/http"
	"os"
	"time"
)

// Login handle login without Google auth
func Login(c *gin.Context) {
	var body LoginRequestDto
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// check if user registered in database
	var userEntity database.UserEntity
	if err := database.DB.QueryRowx("SELECT * FROM user_master WHERE auth_id = ? AND auth_encrypted_pw = ?", body.AuthId, body.EncryptedPassword).StructScan(&userEntity); err != nil {
		if err == sql.ErrNoRows {
			// user not found
			c.AbortWithStatus(http.StatusUnauthorized)
			return
		}
		log.Error(err)
		c.AbortWithStatus(http.StatusInternalServerError)
		return
	}

	if userEntity.UserId == nil {
		log.Error(errors.New("user_id is nil"))
		c.AbortWithStatus(http.StatusInternalServerError)
		return
	}

	userId := *userEntity.UserId

	// set auth token with jwt
	authToken, err := createAuthToken(userId)
	if err != nil {
		log.Error(err)
		c.AbortWithStatus(http.StatusInternalServerError)
		return
	}

	if err := saveRefreshToken(userId, authToken.RefreshToken); err != nil {
		log.Error(err)
		c.AbortWithStatus(http.StatusInternalServerError)
		return
	}

	userDto := UserDtoFromEntity(userEntity)
	authDto := NewAuthTokenDto(authToken.AccessToken, authToken.RefreshToken)
	authResult := &authResultDto{
		User: userDto,
		Auth: authDto,
	}

	c.JSON(http.StatusOK, authResult)
}

func AdminLogin(c *gin.Context) {
	var body LoginRequestDto
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// check if user registered in database
	var userEntity database.UserEntity
	if err := database.DB.QueryRowx("SELECT * FROM user_master WHERE auth_id = ? AND auth_encrypted_pw = ?", body.AuthId, body.EncryptedPassword).StructScan(&userEntity); err != nil {
		if err == sql.ErrNoRows {
			// user not found
			log.Debugf("user not found: %s, %s", body.AuthId, body.EncryptedPassword)
			c.AbortWithStatus(http.StatusUnauthorized)
			return
		}
		log.Error(err)
		c.AbortWithStatus(http.StatusInternalServerError)
		return
	}

	if userEntity.UserId == nil {
		log.Error(errors.New("user_id is nil"))
		c.AbortWithStatus(http.StatusInternalServerError)
		return
	}

	userId := *userEntity.UserId

	var adminEntity database.AdminEntity
	if err := database.DB.QueryRowx("SELECT * FROM admin_master WHERE uid = ?", userId).StructScan(&adminEntity); err != nil {
		if err == sql.ErrNoRows {
			// user not found
			c.AbortWithStatus(http.StatusUnauthorized)
			return
		}
		log.Error(err)
		c.AbortWithStatus(http.StatusInternalServerError)
		return
	}

	// set auth token with jwt
	authToken, err := createAuthToken(userId)
	if err != nil {
		log.Error(err)
		c.AbortWithStatus(http.StatusInternalServerError)
		return
	}

	if err := saveRefreshToken(userId, authToken.RefreshToken); err != nil {
		log.Error(err)
		c.AbortWithStatus(http.StatusInternalServerError)
		return
	}

	userDto := UserDtoFromEntity(userEntity)
	authDto := NewAuthTokenDto(authToken.AccessToken, authToken.RefreshToken)
	authResult := &authResultDto{
		User: userDto,
		Auth: authDto,
	}

	c.JSON(http.StatusOK, authResult)
}

// Signup handle signup without Google auth
func Signup(c *gin.Context) {
	var body SignupRequestDto
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// check if user already registered in database
	var userEntity database.UserEntity
	result := database.DB.QueryRowx("SELECT * FROM user_master WHERE auth_id = ?", body.AuthId)
	err := result.StructScan(&userEntity)
	if err != nil {
		if err == sql.ErrNoRows {
			// create user
			uid := uuid.New().String()
			_, err := database.DB.Exec("INSERT INTO user_master (uid, auth_id, auth_encrypted_pw, username) VALUES (?, ?, ?, ?)",
				uid, body.AuthId, body.EncryptedPassword, body.Username)
			if err != nil {
				log.Error(err)
				c.AbortWithStatus(http.StatusInternalServerError)
				return
			}

			// successfully created user (most standard case)
			result = database.DB.QueryRowx("SELECT * FROM user_master WHERE uid = ?", uid)
			err = result.StructScan(&userEntity)
			if err != nil {
				// error occurred while getting created user data
				log.Error(err)
				c.AbortWithStatus(http.StatusInternalServerError)
				return
			}
			createdUser := UserDtoFromEntity(userEntity)
			c.JSON(http.StatusCreated, createdUser)
		} else {
			// just db error
			log.Error(err)
			c.AbortWithStatus(http.StatusInternalServerError)
			return
		}
	} else {
		c.AbortWithError(http.StatusConflict, errors.New("user already registered"))
		return
	}
}

func RefreshToken(c *gin.Context) {
	// get refresh token from header
	refreshToken := c.GetHeader("X-Refresh-Token")
	if refreshToken == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "refresh token not found"})
		return
	}

	userId, err := database.InMemoryDB.Get(refreshToken)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}

	// check if user exists
	var userEntity database.UserEntity
	if err := database.DB.QueryRowx("SELECT * FROM user_master WHERE uid = ?", userId).StructScan(&userEntity); err != nil {
		if err == sql.ErrNoRows {
			// user not found
			log.Error("user not found")
			c.AbortWithStatus(http.StatusInternalServerError)
			return
		}
		log.Error(err)
		c.AbortWithStatus(http.StatusForbidden)
		return
	}

	authToken, err := createAuthToken(userId)
	if err != nil {
		log.Error(err)
		c.AbortWithStatus(http.StatusInternalServerError)
		return
	}

	if err := saveRefreshToken(userId, authToken.RefreshToken); err != nil {
		log.Error(err)
		c.AbortWithStatus(http.StatusInternalServerError)
		return
	}

	authDto := NewAuthTokenDto(authToken.AccessToken, authToken.RefreshToken)
	c.JSON(http.StatusOK, authDto)
}

func createAuthToken(uid string) (*authTokenDto, error) {
	var err error
	atd := &authTokenDto{}

	// load jwt secret from env
	jwtAccessSecretKey := os.Getenv("JWT_ACCESS_SECRET")
	jwtRefreshSecretKey := os.Getenv("JWT_REFRESH_SECRET")
	jwtAccessExpireTimeRaw := os.Getenv("JWT_ACCESS_EXPIRE")
	jwtRefreshExpireTimeRaw := os.Getenv("JWT_REFRESH_EXPIRE")

	jwtAccessExpireTime, err := util.ParseDuration(jwtAccessExpireTimeRaw)
	if err != nil {
		return nil, err
	}
	jwtRefreshExpireTime, err := util.ParseDuration(jwtRefreshExpireTimeRaw)
	if err != nil {
		return nil, err
	}

	// set access token
	atd.AccessToken.ExpiresAt = time.Now().Add(jwtAccessExpireTime).Unix() // 3 hours expiration
	atd.AccessToken.Uuid = uuid.New().String()
	accessTokenClaims := jwt.MapClaims{}
	accessTokenClaims["uid"] = uid
	accessTokenClaims["exp"] = atd.AccessToken.ExpiresAt
	accessTokenClaims["uuid"] = atd.AccessToken.Uuid
	accessTokenClaims["authorized"] = true
	signedAccessClaims := jwt.NewWithClaims(jwt.SigningMethodHS256, accessTokenClaims)
	atd.AccessToken.Token, err = signedAccessClaims.SignedString([]byte(jwtAccessSecretKey))
	if err != nil {
		return nil, err
	}

	// set refresh token
	atd.RefreshToken.ExpiresAt = time.Now().Add(jwtRefreshExpireTime).Unix() // 7 days expiration
	atd.RefreshToken.Uuid = uuid.New().String()
	refreshTokenClaims := jwt.MapClaims{}
	refreshTokenClaims["uid"] = uid
	refreshTokenClaims["exp"] = atd.RefreshToken.ExpiresAt
	refreshTokenClaims["uuid"] = atd.RefreshToken.Uuid
	signedRefreshClaims := jwt.NewWithClaims(jwt.SigningMethodHS256, refreshTokenClaims)
	atd.RefreshToken.Token, err = signedRefreshClaims.SignedString([]byte(jwtRefreshSecretKey))
	if err != nil {
		return nil, err
	}

	atd.isGoogleAuth = false
	return atd, nil
}

func saveRefreshToken(uid string, refreshToken authToken) error {
	refreshTokenExpiresUnix := time.Unix(refreshToken.ExpiresAt, 0)
	now := time.Now()

	log.Debug("save refresh token", refreshToken.Token, uid, refreshTokenExpiresUnix.Sub(now))
	if err := database.InMemoryDB.SetExp(refreshToken.Token, uid, refreshTokenExpiresUnix.Sub(now)); err != nil {
		return err
	}
	return nil
}

func deleteRefreshToken(refreshToken string) error {
	if err := database.InMemoryDB.Del(refreshToken); err != nil {
		return err
	}
	return nil
}

func UseAuthRouter(g *gin.RouterGroup) {
	sg := g.Group("/auth")
	sg.POST("login", Login)
	sg.POST("admin-login", AdminLogin)
	sg.POST("signup", Signup)
	sg.POST("refreshToken", RefreshToken)
}
