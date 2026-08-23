import React, {useEffect} from 'react';
import {View, Text, Image, Button, Linking} from 'react-native';
import {useDispatch, useSelector} from 'react-redux';
import LoginStyle from './Login.style';
import {unwrapResult} from '@reduxjs/toolkit';
import LoginBg from '@/assets/images/login_bg.png';
import LinearGradient from 'react-native-linear-gradient';
import constantsStyle from '@/styles/constants.style';
import AppTextInput from '@/atoms/AppTextInput';
import AppButton from '@/atoms/AppButton';
import Icon from 'react-native-vector-icons/FontAwesome';
import {authLogin} from '@/thunks/accountThunk';
import {accountAuthSlice, setAccount, setAuth} from '@/store/accountSlice';
import Toast from 'react-native-toast-message';
import {useNavigation} from '@react-navigation/native';
import {getServerEndpoint} from '@/util/common';
import {WebView} from 'react-native-webview';
import {
  GoogleSignin,
  GoogleSigninButton,
} from '@react-native-google-signin/google-signin';
import axios, {AxiosError} from 'axios';
import {GOOGLE_OAUTH_WEB_CLIENT_ID, GOOGLE_OAUTH_IOS_CLIENT_ID} from '@env';

const GOOGLE_AUTHEN_URL = `${getServerEndpoint()}/google_auth/login`;

const Login = (): JSX.Element => {
  const dispatch = useDispatch();
  const navigation = useNavigation();
  const authInfo = useSelector(accountAuthSlice);

  const [isLogin, setIsLogin] = React.useState<boolean>(true);
  const [loginIdInput, setLoginIdInput] = React.useState<string>('');
  const [loginPwInput, setLoginPwInput] = React.useState<string>('');

  const [googleMode, setGoogleMode] = React.useState<boolean>(false);

  const onTryLogin = async () => {
    try {
      const resp = await authLogin({
        loginId: loginIdInput,
        loginPw: loginPwInput,
      });
      const {auth, user} = resp;
      const {access_token, refresh_token} = auth;
      const {
        auth_id,
        google_auth_id,
        google_email,
        google_profile_url,
        uid,
        username,
      } = user;

      dispatch(
        setAuth({
          accessToken: access_token?.token,
          refreshToken: refresh_token?.token,
        }),
      );

      dispatch(
        setAccount({
          uid,
          username,
          googleProfileImageUrl: google_profile_url,
          googleEmail: google_email,
          offlineMode: false,
        }),
      );

      Toast.show({type: 'success', text1: '로그인 성공'});
      console.log(resp);
    } catch (err) {
      console.error(err);
      const code = err?.response?.status ?? null;
      switch (code) {
        case 400:
          Toast.show({type: 'error', text1: '잘못된 요청입니다.'});
          break;
        case 401:
          Toast.show({
            type: 'error',
            text1: '로그인 정보가 일치하지 않습니다.',
          });
          break;
        default:
          Toast.show({
            type: 'error',
            text1: `알 수 없는 오류가 발생했습니다. (code: ${code})`,
          });
          break;
      }
    }
  };

  const onTryGoogleLogin = async () => {
    console.log('onTryGoogleLogin');
    try {
      await GoogleSignin.hasPlayServices();
      const authResult = await GoogleSignin.signIn();
      const url = `${getServerEndpoint()}/google_auth/signup_mobile`;
      try {
        const result = await axios.post(url, {
          google_access_token: authResult.idToken,
        });
        const data = result.data;
        const {auth, user} = data;

        dispatch(
          setAuth({
            accessToken: auth?.access_token?.token,
            refreshToken: auth?.refresh_token?.token,
          }),
        );

        dispatch(
          setAccount({
            uid: user.uid,
            username: user.username,
            googleEmail: user.google_email,
            googleProfileImageUrl: user.google_profile_image_url,
          }),
        );

        Toast.show({type: 'success', text1: '로그인 성공'});
      } catch (err) {
        if (err instanceof AxiosError) {
          console.error(err.response?.statusText);
        }
        console.error(err);
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    GoogleSignin.configure({
      webClientId: GOOGLE_OAUTH_WEB_CLIENT_ID,
      iosClientId: GOOGLE_OAUTH_IOS_CLIENT_ID,
    });
  }, []);

  return (
    <View style={LoginStyle.loginContainer}>
      <View style={LoginStyle.bgImage}>
        <Image source={LoginBg} />
      </View>
      <LinearGradient
        testID="bg-image"
        colors={[
          constantsStyle.mainBgColor,
          `rgba(${constantsStyle.mainBgColor.slice(4, -1)}, 0.7)`,
        ]}
        start={{x: 0.2, y: 0.5}}
        end={{x: 1, y: 1}}
        style={LoginStyle.linearGradient}></LinearGradient>
      <View testID="login-form-wrapper" style={LoginStyle.loginFormWrapper}>
        <View testID="login-form" style={LoginStyle.loginForm}>
          <Text style={LoginStyle.guide}>언제 어디서나, 쉽고 편하게.</Text>
          <Text style={LoginStyle.loginTitle}>메모리얼 로그인</Text>
          <View testID="login-input" style={LoginStyle.inputs}>
            <Text style={LoginStyle.inputGuide}>아이디</Text>
            <AppTextInput
              style={LoginStyle.inputText}
              value={loginIdInput}
              onChangeText={e => setLoginIdInput(e)}
            />
          </View>
          <View testID="login-input" style={LoginStyle.inputs}>
            <Text style={LoginStyle.inputGuide}>비밀번호</Text>
            <AppTextInput
              style={LoginStyle.inputText}
              secureTextEntry={true}
              value={loginPwInput}
              onChangeText={e => setLoginPwInput(e)}
            />
          </View>
          <View style={LoginStyle.loginBtnMargin} />
          <AppButton
            title="로그인"
            size={11}
            weight="bold"
            color="#e4e4e4"
            onPress={onTryLogin}
            style={[LoginStyle.formBtn, LoginStyle.loginBtn]}></AppButton>
          <View style={LoginStyle.signupBtnMargin} />
          <AppButton
            title="회원가입"
            size={11}
            weight="bold"
            color="#e4e4e4"
            style={[LoginStyle.formBtn, LoginStyle.signupBtn]}></AppButton>
          <View style={LoginStyle.splitLine}>
            <View testID="spliter" style={LoginStyle.spliter}></View>
            <Text style={LoginStyle.spliterText}>또는</Text>
            <View testID="spliter" style={LoginStyle.spliter}></View>
          </View>
          <AppButton
            icon={
              <Icon name="google" color={'white'} style={{marginRight: 5}} />
            }
            title="구글로 로그인"
            size={11}
            weight="bold"
            color="#e4e4e4"
            onPress={onTryGoogleLogin}
            style={[LoginStyle.formBtn, LoginStyle.googleBtn]}></AppButton>
        </View>
      </View>
      {googleMode && (
        <View
          style={{
            position: 'absolute',
            bottom: 0,
            height: 500,
            width: '100%',
            borderTopRightRadius: 10,
            borderTopLeftRadius: 10,
            overflow: 'hidden',
          }}>
          <WebView
            source={{uri: GOOGLE_AUTHEN_URL}}
            onMessage={e => {
              console.log(e);
            }}
          />
        </View>
      )}
    </View>
  );
};

export default Login;
