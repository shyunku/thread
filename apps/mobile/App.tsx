/**
 * Sample React Native App
 * https://github.com/facebook/react-native
 *
 * @format
 */

import React from 'react';
import type {PropsWithChildren} from 'react';
import {Provider} from 'react-redux';
import {
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  useColorScheme,
  View,
} from 'react-native';
import indexStyle from '@/styles/index.style';
import {configureStore} from '@reduxjs/toolkit';
import persistedReducer from '@/reducers/rootReducer';
import {Platform} from 'react-native';
import 'react-native-gesture-handler';
import Toast from 'react-native-toast-message';
import Navigation from '@/routers/navigation';
import {persistStore} from 'redux-persist';
import {PersistGate} from 'redux-persist/integration/react';

const originalConsoleLog = console.log;
console.log = (...arg) => {
  const os = Platform.OS;
  let prefix = `${os}`;
  switch (os) {
    case 'ios':
      prefix = '🍎';
      break;
    case 'android':
      prefix = '🤖';
      break;
  }
  originalConsoleLog(prefix, ...arg);
};

function App(): JSX.Element {
  const isDarkMode = useColorScheme() === 'dark';

  const store = configureStore({
    reducer: persistedReducer,
    middleware: defaultMiddleware =>
      defaultMiddleware({serializableCheck: false}),
  });

  const persistor = persistStore(store);
  // persistor.purge();

  return (
    <SafeAreaView style={indexStyle.appContainer}>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
      <Provider store={store}>
        <PersistGate loading={null} persistor={persistor}>
          <Navigation />
          <Toast />
        </PersistGate>
      </Provider>
    </SafeAreaView>
  );
}

export default App;
