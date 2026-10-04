import { View } from 'react-native';
import { useApp } from '@/app/AppContext';
import { Body, Button, Screen, Title } from '@/ui/kit';

// The vault's creation did not finish (#83: never reset automatically).
export default function VaultProblemScreen() {
  const { runtime } = useApp();
  return (
    <Screen>
      <View style={{ padding: 24, paddingTop: 120 }}>
        <Title>이 휴대폰의 보관함을 열 수 없어요</Title>
        <Body muted>
          처음 설정이 끝나기 전에 앱이 멈췄어요. 데이터는 서버와 다른 기기에
          그대로 있어요. 앱을 지우고 다시 설치한 뒤 연결하면 돼요.
        </Body>
      </View>
      <Button kind="ghost" label="로그아웃" onPress={() => runtime.signOut()} />
    </Screen>
  );
}
