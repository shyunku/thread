import {
  GoogleSignin,
  isErrorWithCode,
  isSuccessResponse,
  statusCodes,
} from '@react-native-google-signin/google-signin';
import { Platform } from 'react-native';
import { config } from '@/core/config';
import { AuthError } from './api';

// Google account chooser -> ID token for the server (POST /v1/google_auth/signup_mobile).
// The ID token's audience is the web client ID (GOOGLE_OAUTH_WEB_CLIENT_ID), the same
// client the desktop uses. Sign-in also needs an Android OAuth client registered in
// Google Cloud for package kr.threadapp.mobile and the app's signing certificate.
export async function googleIdToken(): Promise<string> {
  // iOS also needs its own OAuth client ID and URL scheme (#93); until then the
  // button reports that Google sign-in is not set up.
  if (!config.googleWebClientId || Platform.OS === 'ios')
    throw new AuthError('GOOGLE_NOT_CONFIGURED');
  GoogleSignin.configure({
    webClientId: config.googleWebClientId,
    scopes: ['email', 'profile'],
  });
  try {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    // Always show the chooser; Thread keeps its own session, not Google's.
    await GoogleSignin.signOut().catch(() => null);
    const response = await GoogleSignin.signIn();
    if (!isSuccessResponse(response)) throw new AuthError('GOOGLE_CANCELLED');
    const token = response.data.idToken;
    if (!token) throw new AuthError('GOOGLE_LOGIN_FAILED');
    return token;
  } catch (error: any) {
    if (error instanceof AuthError) throw error;
    if (isErrorWithCode(error) && error.code === statusCodes.SIGN_IN_CANCELLED)
      throw new AuthError('GOOGLE_CANCELLED');
    if (
      isErrorWithCode(error) &&
      error.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE
    ) {
      throw new AuthError('PLAY_SERVICES_UNAVAILABLE');
    }
    throw new AuthError('GOOGLE_LOGIN_FAILED');
  }
}
