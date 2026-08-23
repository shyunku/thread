const {createSlice, current} = require('@reduxjs/toolkit');

const initialState = Object.freeze({
  account: {
    uid: null,
    username: null,
    profileImageUrl: null,
    googleEmail: null,
    googleProfileImageUrl: null,
    offlineMode: false,
  },
  auth: {
    accessToken: null,
    refreshToken: null,
  },
});

const accountSlice = createSlice({
  name: 'account',
  initialState,
  reducers: {
    setAccount: (state: any, action: any) => {
      state.account = {...current(state).account, ...action.payload};
    },
    setAuth: (state: any, action: any) => {
      state.auth = {...current(state).auth, ...action.payload};
    },
    removeAccount: (state: any, action: any) => {
      state.account = initialState.account;
    },
    removeAuth: (state: any, action: any) => {
      state.auth = initialState.auth;
    },
  },
});

export const {setAuth, removeAuth, setAccount, removeAccount} =
  accountSlice.actions;
export const accountAuthSlice = (state: any) => state.account.auth;
export const accountInfoSlice = (state: any) => state.account.account;

export default accountSlice.reducer;
