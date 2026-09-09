import React, {useEffect, useState} from 'react';
import {AppRegistry, AppState, Button, ScrollView, Text, View} from 'react-native';
import {Platform} from 'react-native';
import * as Keychain from 'react-native-keychain';
import {Buffer} from 'buffer';
import {createMobileKeyProtection} from '../src/sync/keyProtection';
import {name as appName} from '../app.json';

// Separate applicationId; fixed synthetic material, no app login or networking.
const scope = {environment: 'development', accountId: 'synthetic-native-probe', vaultId: 'native-probe-v1'};
const provider = createMobileKeyProtection(Keychain, Platform.OS);
function Probe() {
  const [status, setStatus] = useState('LOCKED'), [busy, setBusy] = useState(false);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'active') setStatus('LOCKED');
    });
    return () => subscription.remove();
  }, []);
  async function run(create) {
    setBusy(true);setStatus('AUTHENTICATING');
    let key;
    try {
      if (create) {
        key = Buffer.alloc(32, 37);
        await provider.create(scope, key);
        setStatus('CREATED: 이제 키 읽기를 눌러주세요.');
      } else {
        key = await provider.open(scope);
        setStatus(key.equals(Buffer.alloc(32, 37)) ? 'VERIFIED' : 'KEY_MISMATCH');
      }
    } catch (error) {
      setStatus(error.message === 'VAULT_KEY_EXISTS' ? '이미 생성됨: 키 읽기를 눌러주세요.' : 'AUTH_FAILED_OR_CANCELLED');
    } finally {key?.fill(0);setBusy(false);}
  }
  return <ScrollView contentContainerStyle={{padding:24,paddingTop:48}}>
    <Text style={{fontSize:24,color:'#111',marginBottom:16}}>Thread E2EE · 키 저장소 테스트</Text>
    <Text style={{color:'#111',marginBottom:16}}>실제 계정·할 일·서버를 사용하지 않습니다. 고정된 테스트 키만 이 별도 앱에 저장합니다.</Text>
    <View style={{marginBottom:12}}><Button disabled={busy} title="1. 테스트 키 생성" onPress={() => run(true)} /></View>
    <View style={{marginBottom:12}}><Button disabled={busy} title="2. OS 인증 후 키 읽기" onPress={() => run(false)} /></View>
    <Button disabled={busy} title="화면 잠금" onPress={() => setStatus('LOCKED')} />
    <Text selectable style={{color:'#111',fontSize:18,marginTop:24}}>{status}</Text>
    <Text style={{color:'#333',marginTop:24}}>키 읽기 성공(VERIFIED), 인증 취소, 앱 재시작 후 키 읽기를 확인해주세요. 테스트가 끝나면 이 앱을 제거해도 기존 Thread 데이터에는 영향이 없습니다.</Text>
  </ScrollView>;
}
AppRegistry.registerComponent(appName, () => Probe);
