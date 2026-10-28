import { useState, type ReactNode } from 'react';
import { STORE_PREVIEW } from '@env';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { createRuntime } from '@/core/app/runtime';
import { installErrorLogging } from '@/core/log';
import { ThemeProvider } from '@/ui/theme';
import { AppProvider, useApp, type AppRuntime } from './AppContext';
import Navigation from './navigation';

installErrorLogging();

function Themed() {
  const { prefs } = useApp();
  return (
    <ThemeProvider mode={prefs.theme}>
      <Navigation />
    </ThemeProvider>
  );
}

export default function App({ runtime: injected }: { runtime?: AppRuntime }) {
  // Debug builds with STORE_PREVIEW=1 show synthetic screens for store screenshots (#92).
  // The condition is written inline so a release bundle folds it away with the preview.
  if (__DEV__ && STORE_PREVIEW === '1') {
    const { StorePreviewProvider } = require('@/preview/storePreview') as {
      StorePreviewProvider: (props: { children: ReactNode }) => ReactNode;
    };
    return (
      <SafeAreaProvider>
        <StorePreviewProvider>
          <Themed />
        </StorePreviewProvider>
      </SafeAreaProvider>
    );
  }
  return <RealApp injected={injected} />;
}

function RealApp({ injected }: { injected?: AppRuntime }) {
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
