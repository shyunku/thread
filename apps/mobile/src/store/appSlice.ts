import { createSlice, PayloadAction } from '@reduxjs/toolkit';

// App-wide UI state. Account, vault and task state get their own slices later (#84~#88).
export type AppState = { ready: boolean };

const initialState: AppState = { ready: false };

const appSlice = createSlice({
  name: 'app',
  initialState,
  reducers: {
    setReady: (state, action: PayloadAction<boolean>) => {
      state.ready = action.payload;
    },
  },
});

export const { setReady } = appSlice.actions;
export default appSlice.reducer;
