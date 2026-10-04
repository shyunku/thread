import { configureStore } from '@reduxjs/toolkit';
import appReducer from './appSlice';

export function createStore() {
  return configureStore({ reducer: { app: appReducer } });
}

export type AppStore = ReturnType<typeof createStore>;
export type RootState = ReturnType<AppStore['getState']>;
export type AppDispatch = AppStore['dispatch'];
