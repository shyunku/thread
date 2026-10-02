import { combineReducers } from "@reduxjs/toolkit";
import persistReducer from "redux-persist/es/persistReducer";
import storage from "redux-persist/lib/storage";
import accountReducer from "store/accountSlice";
import prefsReducer from "store/prefsSlice";

const persistConfig = {
  key: "root",
  storage,
};

const rootReducers = combineReducers({
  account: accountReducer,
  prefs: prefsReducer,
});

export default persistReducer(persistConfig, rootReducers);
