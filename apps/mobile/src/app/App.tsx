import { useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { createRuntime } from '@/core/app/runtime';
import { ThemeProvider } from '@/ui/theme';
import { AppProvider, useApp, type AppRuntime } from './AppContext';
import Navigation from './navigation';

function Themed() {
  const { prefs } = useApp();
  return (
    <ThemeProvider mode={prefs.theme}>
      <Navigation />
    </ThemeProvider>
  );
}

export default function App({ runtime: injected }: { runtime?: AppRuntime }) {
  const [runtime] = useState<AppRuntime>(
    () => injected ?? (createRuntime() as unknown as AppRuntime),
  );
  return (
    <SafeAreaProvider>
      <AppProvider runtime={runtime}>
        <Themed />
      </AppProvider>
    </SafeAreaProvider>
  );
}
