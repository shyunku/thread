import constantsStyle from '@/styles/constants.style';
import {StyleSheet} from 'react-native';

const LoginStyle = StyleSheet.create({
  loginContainer: {
    flex: 1,
    position: 'relative',
  },
  bgImage: {
    flex: 1,
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  },
  linearGradient: {
    flex: 1,
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  },
  loginFormWrapper: {
    flex: 1,
    justifyContent: 'center',
    // backgroundColor: 'blue',
  },
  loginForm: {
    marginTop: -60,
    // marginLeft: 40,
    // width: '100%',
    // backgroundColor: 'red',
    alignItems: 'center',
  },
  guide: {
    color: 'white',
    fontSize: 9,
    marginBottom: 5,
    // width: '100%',
    // textAlign: 'left',
  },
  loginTitle: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 22,
    marginBottom: 10,
  },
  inputs: {
    marginTop: 15,
  },
  inputGuide: {
    color: '#ffffff60',
    fontSize: 9,
  },
  inputText: {
    backgroundColor: 'rgba(255,255,255,0.07)',
    marginTop: 6,
    fontSize: 12,
    height: 30,
    width: 250,
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 3,
    color: 'white',
  },
  formBtn: {
    width: 250,
  },
  loginBtnMargin: {
    marginTop: 30,
  },
  loginBtn: {
    backgroundColor: '#354c7a',
  },
  signupBtnMargin: {
    marginTop: 12,
  },
  signupBtn: {
    backgroundColor: '#564a63',
  },
  googleBtn: {
    backgroundColor: '#00000000',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  splitLine: {
    flexDirection: 'row',
    width: 250,
    alignItems: 'center',
    marginVertical: 16,
  },
  spliter: {
    height: 0,
    flex: 1,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.15)',
  },
  spliterText: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: 9,
    marginHorizontal: 8,
  },
});

export default LoginStyle;
