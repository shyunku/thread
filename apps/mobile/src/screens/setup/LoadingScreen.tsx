import { ActivityIndicator, Image, Platform, View } from 'react-native';
import { useTheme } from '@/ui/theme';

// The start-up logo screen (#112 mock): the logo in the middle of the window, where the
// Android splash and window background draw it (res/drawable/splash_window.xml), and a
// small spinner below it.
export default function LoadingScreen() {
  const theme = useTheme();
  return (
    <View
      accessibilityLabel="불러오는 중"
      style={{ flex: 1, backgroundColor: theme.canvas }}
    >
      <Image
        source={require('@/assets/logo.png')}
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          width: 128,
          height: 128,
          marginTop: -64,
          marginLeft: -64,
        }}
      />
      <View
        style={{
          position: 'absolute',
          top: '50%',
          left: 0,
          right: 0,
          marginTop: 96,
          alignItems: 'center',
        }}
      >
        <ActivityIndicator
          color={theme.accent}
          size={Platform.OS === 'android' ? 24 : 'small'}
        />
      </View>
    </View>
  );
}
