package v1

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt"
	"github.com/google/uuid"
	"golang.org/x/oauth2"
	"io"
	"io/ioutil"
	"math/big"
	"net/http"
	"os"
	"time"
	"thread_api/log"
	database2 "thread_api/service/database"
)

var (
	clientId,
	clientSecret,
	redirectUrl string
	config *oauth2.Config
)

type GoogleOauth2UserInfo struct {
	Email         string `json:"email"`
	Id            string `json:"id"` // google auth id
	Picture       string `json:"picture"`
	VerifiedEmail bool   `json:"verified_email"`
}

func InitializeGoogleOauth() {
	clientId = os.Getenv("GOOGLE_OAUTH2_CLIENT_ID")
	clientSecret = os.Getenv("GOOGLE_OAUTH2_CLIENT_SECRET")
	redirectUrl = os.Getenv("GOOGLE_OAUTH2_REDIRECT_URL")
	config = &oauth2.Config{
		ClientID:     clientId,
		ClientSecret: clientSecret,
		Scopes:       []string{"https://www.googleapis.com/auth/userinfo.email"},
		RedirectURL:  redirectUrl,
		Endpoint: oauth2.Endpoint{
			AuthURL:  "https://accounts.google.com/o/oauth2/auth",
			TokenURL: "https://accounts.google.com/o/oauth2/token",
		},
	}

	if clientId == "" || clientSecret == "" || redirectUrl == "" {
		panic("Missing environment variables for Google OAuth2 configuration")
	}
}

func SignupWithGoogleAuth(c *gin.Context) {
	var body SignupWithGoogleAuthRequestDto
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	identity, err := parseGoogleLinkToken(body.GoogleLinkToken, time.Now())
	if err != nil {
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"code": "GOOGLE_LINK_INVALID"})
		return
	}
	mode, modeErr := signupMode(body.SignupMode)
	if modeErr != nil {
		signupModeError(c, modeErr)
		return
	}

	var linked int
	if err = database2.DB.QueryRow("SELECT COUNT(*) FROM user_master WHERE google_auth_id = ?", identity.Id).Scan(&linked); err != nil {
		log.Error(err)
		c.AbortWithStatus(http.StatusInternalServerError)
		return
	}
	if linked > 0 {
		c.AbortWithStatus(http.StatusConflict)
		return
	}

	var userEntity database2.UserEntity
	err = database2.DB.QueryRowx("SELECT * FROM user_master WHERE auth_id = ?", body.AuthId).StructScan(&userEntity)
	if err == sql.ErrNoRows {
		// New account created together with the verified Google identity.
		uid := uuid.New().String()
		err = createSignupUser(c, uid, mode,
			"INSERT INTO user_master (uid, username, auth_id, auth_encrypted_pw, google_auth_id, google_email, google_profile_image_url) VALUES (?, ?, ?, ?, ?, ?, ?)",
			uid, body.Username, body.AuthId, body.EncryptedPassword, identity.Id, identity.Email, identity.Picture,
		)
		if err != nil {
			log.Error(err)
			c.AbortWithStatus(http.StatusInternalServerError)
			return
		}
	} else if err != nil {
		log.Error(err)
		c.AbortWithStatus(http.StatusInternalServerError)
		return
	} else {
		// Linking an existing account requires that account's password.
		if userEntity.GoogleAuthId != nil {
			c.AbortWithStatus(http.StatusConflict)
			return
		}
		if !passwordMatches(userEntity.AuthEncryptedPw, body.EncryptedPassword) {
			c.AbortWithStatus(http.StatusUnauthorized)
			return
		}
		updated, err := database2.DB.Exec("UPDATE user_master SET google_auth_id = ?, google_email = ?, google_profile_image_url = ? WHERE uid = ? AND google_auth_id IS NULL",
			identity.Id, identity.Email, identity.Picture, *userEntity.UserId)
		if err != nil {
			log.Error(err)
			c.AbortWithStatus(http.StatusInternalServerError)
			return
		}
		if rows, _ := updated.RowsAffected(); rows != 1 {
			c.AbortWithStatus(http.StatusConflict)
			return
		}
	}

	// rescan user
	err = database2.DB.QueryRowx("SELECT * FROM user_master WHERE google_auth_id = ? LIMIT 1", identity.Id).StructScan(&userEntity)
	if err != nil {
		log.Error(err)
		c.AbortWithStatus(http.StatusInternalServerError)
		return
	}

	c.JSON(http.StatusOK, userEntity)
}

func SignupWithMobileGoogleAuth(c *gin.Context) {
	var body SignupWithMobileGoogleAuthRequestDto
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	pubKeys, err := fetchGoogleOauthPublicRsaKeys()

	// validate access token as jwt
	token, err := jwt.Parse(body.GoogleAccessToken, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodRSA); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}

		kid, ok := token.Header["kid"].(string)
		if !ok {
			return nil, fmt.Errorf("kid not found")
		}

		for _, key := range pubKeys {
			var jwk struct {
				Kid string `json:"kid"`
				N   string `json:"n"`
				E   string `json:"e"`
			}
			if err := json.Unmarshal(key, &jwk); err != nil {
				continue
			}
			if jwk.Kid == kid {
				nBytes, err := base64.RawURLEncoding.DecodeString(jwk.N)
				if err != nil {
					return nil, fmt.Errorf("failed to decode N value: %v", err)
				}

				eBytes, err := base64.RawURLEncoding.DecodeString(jwk.E)
				if err != nil {
					return nil, fmt.Errorf("failed to decode E value: %v", err)
				}

				n := new(big.Int).SetBytes(nBytes)
				e := new(big.Int).SetBytes(eBytes)

				publicKey := &rsa.PublicKey{
					N: n,
					E: int(e.Int64()),
				}
				return publicKey, nil
			}
		}
		return nil, fmt.Errorf("public key not found for kid: %s", kid)
	})
	if err != nil {
		log.Error(err)
		c.AbortWithError(http.StatusBadRequest, err)
		return
	}

	// check if token is valid
	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok || !token.Valid {
		log.Error(err)
		c.AbortWithError(http.StatusBadRequest, err)
		return
	}

	// The signature alone proves Google issued the token, not that it was issued to Thread.
	identity, _, err := googleIdTokenIdentity(claims, time.Now())
	if err != nil {
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"code": "GOOGLE_TOKEN_REJECTED"})
		return
	}
	googleAuthId := identity.Id

	var userEntity database2.UserEntity
	result := database2.DB.QueryRowx("SELECT * FROM user_master WHERE google_auth_id = ?", googleAuthId)
	err = result.StructScan(&userEntity)
	if err == sql.ErrNoRows {
		// Same as the desktop OAuth callback: an unlinked Google account gets a link token
		// so the app can link an existing account (its password) or sign up, instead of
		// silently creating a separate account.
		linkToken, linkErr := createGoogleLinkToken(identity, time.Now())
		if linkErr != nil {
			log.Error(linkErr)
			c.AbortWithStatus(http.StatusInternalServerError)
			return
		}
		c.JSON(http.StatusOK, googleAuthResultDto{LinkToken: linkToken})
		return
	}
	if err != nil {
		log.Error(err)
		c.AbortWithStatus(http.StatusInternalServerError)
		return
	}

	// rescan user
	result = database2.DB.QueryRowx("SELECT * FROM user_master WHERE google_auth_id = ? LIMIT 1", googleAuthId)
	err = result.StructScan(&userEntity)
	if err != nil {
		log.Error(err)
		c.AbortWithStatus(http.StatusInternalServerError)
		return
	}

	userId := *userEntity.UserId
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

func GoogleOauth2Login(c *gin.Context) {
	// create random token to prevent CSRF
	stateToken := createGoogleOauthState()

	// save token to session
	c.SetCookie("oauthstate", stateToken, 0, "/", "", false, true)
	c.Header("Cache-Control", "no-cache, no-store, must-revalidate") // Set Cache-Control header
	url := config.AuthCodeURL(stateToken, oauth2.AccessTypeOffline)

	// redirect to Google's consent page to ask for permission
	c.Redirect(http.StatusMovedPermanently, url)
}

func GoogleOauth2Callback(c *gin.Context) {
	stateToken, err := c.Cookie("oauthstate")
	if err != nil {
		log.Error(err)
		c.AbortWithError(http.StatusBadRequest, err)
		return
	}

	if c.Query("state") != stateToken {
		c.AbortWithStatus(http.StatusUnauthorized)
		return
	}

	token, err := config.Exchange(context.Background(), c.Query("code"))
	if err != nil {
		log.Error(err)
		c.AbortWithStatus(http.StatusInternalServerError)
		return
	}

	response, err := http.Get("https://www.googleapis.com/oauth2/v2/userinfo?access_token=" + token.AccessToken)
	if err != nil {
		log.Error(err)
		c.AbortWithStatus(http.StatusInternalServerError)
		return
	}
	defer response.Body.Close()
	contents, err := io.ReadAll(response.Body)
	if err != nil {
		log.Error(err)
		c.AbortWithStatus(http.StatusInternalServerError)
		return
	}

	var googleOauthUserInfo GoogleOauth2UserInfo
	err = json.Unmarshal(contents, &googleOauthUserInfo)
	if err != nil {
		log.Error(err)
		c.AbortWithStatus(http.StatusInternalServerError)
		return
	}

	if googleOauthUserInfo.Email == "" {
		// try to parse
		var googleUserInfoFetchError GoogleUserInfoFetchErrorDto
		err = json.Unmarshal(contents, &googleUserInfoFetchError)
		if err != nil {
			var googleUserInfoFetchError2 GoogleUserInfoFetchErrorDto2
			err = json.Unmarshal(contents, &googleUserInfoFetchError2)
			if err != nil {
				log.Error(err)
				c.AbortWithStatus(http.StatusInternalServerError)
				return
			}
			c.AbortWithStatusJSON(http.StatusInternalServerError, googleUserInfoFetchError2.ErrorDescription)
		}
		c.AbortWithError(http.StatusInternalServerError, fmt.Errorf("failed to fetch google user info [%d]: %s",
			googleUserInfoFetchError.Error.Code, googleUserInfoFetchError.Error.Message))
		return
	}

	var googleAuthResult googleAuthResultDto

	googleAuthResult.GoogleUserInfo = &googleOauthUserInfo
	if response.StatusCode != http.StatusOK || googleOauthUserInfo.Id == "" || !googleOauthUserInfo.VerifiedEmail {
		c.AbortWithStatus(http.StatusUnauthorized)
		return
	}
	var user database2.UserEntity
	err = database2.DB.QueryRowx("SELECT * FROM user_master WHERE google_auth_id = ? LIMIT 1", googleOauthUserInfo.Id).StructScan(&user)
	if err != nil && err != sql.ErrNoRows {
		c.AbortWithStatus(http.StatusInternalServerError)
		return
	}
	if err == nil {
		googleAuthResult.User = UserDtoFromEntity(user)
		googleAuthResult.Auth, err = createGoogleLoginSession(c.Request.Context(), *user.UserId)
		if err != nil {
			c.AbortWithStatus(http.StatusInternalServerError)
			return
		}
	} else {
		googleAuthResult.LinkToken, err = createGoogleLinkToken(googleIdentity{
			Id: googleOauthUserInfo.Id, Email: googleOauthUserInfo.Email, Picture: googleOauthUserInfo.Picture,
		}, time.Now())
		if err != nil {
			log.Error(err)
			c.AbortWithStatus(http.StatusInternalServerError)
			return
		}
	}

	page, err := googleOauthResultPage(googleAuthResult)
	if err != nil {
		log.Error(err)
		c.AbortWithStatus(http.StatusInternalServerError)
		return
	}
	googleOauthResultHeaders(c.Header)
	c.Data(http.StatusOK, "text/html; charset=utf-8", page)
}

// Google credentials identify the user; Thread credentials authorize API access.
func createGoogleLoginSession(ctx context.Context, uid string) (*authTokenDto, error) {
	if uid == "" {
		return nil, fmt.Errorf("missing user ID")
	}
	return issueSession(ctx, uid, false)
}

func fetchGoogleOauthPublicRsaKeys() ([]json.RawMessage, error) {
	resp, err := http.Get("https://www.googleapis.com/oauth2/v3/certs")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := ioutil.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var jwkSet struct {
		Keys []json.RawMessage `json:"keys"`
	}
	if err := json.Unmarshal(body, &jwkSet); err != nil {
		fmt.Println("Failed to parse JWK set:", err)
		return nil, err
	}

	return jwkSet.Keys, nil
}

func createGoogleOauthState() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return ""
	}
	return base64.URLEncoding.EncodeToString(b)
}

func UseGoogleAuthRouter(g *gin.RouterGroup) {
	sg := g.Group("/google_auth")
	sg.POST("signup", SignupWithGoogleAuth)
	sg.POST("signup_mobile", SignupWithMobileGoogleAuth)
	sg.GET("login", GoogleOauth2Login)
	sg.GET("login_callback", GoogleOauth2Callback)
}
