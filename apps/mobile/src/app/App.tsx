import { useState } from 'react';
import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Provider } from 'react-redux';
import { createStore } from '@/store';
import Navigation from './navigation';

export default function App() {
  const [store] = useState(createStore);
  return (
    <Provider store={store}>
      <SafeAreaProvider>
        <StatusBar barStyle="light-content" />
        <Navigation />
      </SafeAreaProvider>
    </Provider>
  );
}
