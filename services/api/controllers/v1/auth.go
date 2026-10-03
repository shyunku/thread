package v1

import (
	"database/sql"
	"errors"
	"net/http"
	"os"
	"thread_api/log"
	"thread_api/service/database"
	"thread_api/util"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt"
	"github.com/google/uuid"
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

	// start a login session
	authToken, err := issueSession(c.Request.Context(), userId, false)
	if err != nil {
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

	if !validateAdminCredentials(body) {
		c.AbortWithStatus(http.StatusUnauthorized)
		return
	}

	adminId := os.Getenv("ADMIN_ID")

	// start a login session
	authToken, err := issueSession(c.Request.Context(), adminTokenSubject, true)
	if err != nil {
		log.Error(err)
		c.AbortWithStatus(http.StatusInternalServerError)
		return
	}

	userDto := NewUserDto(adminTokenSubject, &adminId, &adminId, nil, nil, nil, nil)
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
	mode, err := signupMode(body.SignupMode)
	if err != nil {
		signupModeError(c, err)
		return
	}

	// check if user already registered in database
	var userEntity database.UserEntity
	result := database.DB.QueryRowx("SELECT * FROM user_master WHERE auth_id = ?", body.AuthId)
	err = result.StructScan(&userEntity)
	if err != nil {
		if err == sql.ErrNoRows {
			// create user
			uid := uuid.New().String()
			err := createSignupUser(c, uid, mode, "INSERT INTO user_master (uid, auth_id, auth_encrypted_pw, username) VALUES (?, ?, ?, ?)",
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

// createAuthTokenWithRole signs an access/refresh token pair for session sid.
func createAuthTokenWithRole(uid string, isAdmin bool, sid string) (*authTokenDto, error) {
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
	accessTokenClaims["admin"] = isAdmin
	accessTokenClaims["exp"] = atd.AccessToken.ExpiresAt
	accessTokenClaims["uuid"] = atd.AccessToken.Uuid
	accessTokenClaims["authorized"] = true
	accessTokenClaims["sid"] = sid
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
	refreshTokenClaims["admin"] = isAdmin
	refreshTokenClaims["exp"] = atd.RefreshToken.ExpiresAt
	refreshTokenClaims["uuid"] = atd.RefreshToken.Uuid
	refreshTokenClaims["sid"] = sid
	signedRefreshClaims := jwt.NewWithClaims(jwt.SigningMethodHS256, refreshTokenClaims)
	atd.RefreshToken.Token, err = signedRefreshClaims.SignedString([]byte(jwtRefreshSecretKey))
	if err != nil {
		return nil, err
	}

	atd.isGoogleAuth = false
	return atd, nil
}

func UseAuthRouter(g *gin.RouterGroup) {
	sg := g.Group("/auth")
	sg.POST("login", Login)
	sg.POST("admin-login", AdminLogin)
	sg.POST("signup", Signup)
	sg.POST("refreshToken", RefreshToken)
	sg.POST("logout", Logout)
	sg.POST("sessions/revoke", AuthMiddleware, RevokeSessions)
}
