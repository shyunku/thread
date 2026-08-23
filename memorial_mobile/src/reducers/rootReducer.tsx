import {combineReducers} from 'redux';
import accountSlice from '@/store/accountSlice';
import stateSlice from '@/store/stateSlice';
import currentSlice from '@/store/currentSlice';
import {persistStore, persistReducer} from 'redux-persist';
import AsyncStorage from '@react-native-async-storage/async-storage';

const rootReducer = combineReducers({
  account: accountSlice,
  txState: stateSlice,
  current: currentSlice,
});

const persistConfig = {
  key: 'root',
  storage: AsyncStorage,
};

const persistedReducer = persistReducer(persistConfig, rootReducer);
export default persistedReducer;
