import {createAsyncThunk} from '@reduxjs/toolkit';
import axios from 'axios';
import sha256 from 'sha256';

interface LoginParams {
  loginId: string;
  loginPw: string;
}

export const authLogin = async ({loginId, loginPw}: LoginParams) => {
  const encryptedPw = sha256(sha256(loginId) + loginPw);
  const doubleEncrypted = sha256(encryptedPw);
  const response = await axios.post('/auth/login', {
    auth_id: loginId,
    encrypted_password: doubleEncrypted,
  });
  return response?.data;
};
