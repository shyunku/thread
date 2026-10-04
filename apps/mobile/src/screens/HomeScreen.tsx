import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors } from '@/app/theme';
import { runE2eeSelfTest } from '@/core/e2ee/selfTest';

// Placeholder until the real screens land (#87 design, #88 tasks).
export default function HomeScreen() {
  const [selfTest, setSelfTest] = useState<string | null>(null);

  useEffect(() => {
    if (!__DEV__) return;
    runE2eeSelfTest()
      .then(failures =>
        setSelfTest(
          failures.length
            ? `E2EE 확인 실패 ${failures.length}개: ${failures[0]}`
            : 'E2EE 확인 통과',
        ),
      )
      .catch(error => setSelfTest(`E2EE 확인 오류: ${error.message}`));
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Thread</Text>
      <Text style={styles.subtitle}>모바일 2.0 준비 중</Text>
      {selfTest && <Text style={styles.devNote}>{selfTest}</Text>}
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
  devNote: {
    marginTop: 24,
    paddingHorizontal: 24,
    color: colors.muted,
    fontSize: 12,
    textAlign: 'center',
  },
});
