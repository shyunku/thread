import { StyleSheet, Text, View } from 'react-native';
import { colors } from '@/app/theme';

// Placeholder until the real screens land (#87 design, #88 tasks).
export default function HomeScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Thread</Text>
      <Text style={styles.subtitle}>모바일 2.0 준비 중</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.canvas,
  },
  title: { color: colors.text, fontSize: 28, fontWeight: '700' },
  subtitle: { marginTop: 6, color: colors.secondary, fontSize: 14 },
});
