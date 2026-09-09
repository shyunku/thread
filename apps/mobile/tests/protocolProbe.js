import React, {useEffect, useState} from 'react';
import {AppRegistry, ScrollView, Text} from 'react-native';
import {Buffer} from 'buffer';
import {protocol as p} from '../src/sync/e2ee/protocol';
import vector from '../../../docs/protocol/e2ee-v1-vector.json';
import genesisVector from '../../../docs/protocol/e2ee-genesis-vector.json';
import {name as appName} from '../app.json';

// Automatic synthetic interoperability check; never opens a user key or account.
async function checkProtocol() {
  const key=Buffer.from(vector.secretHex,'hex'),context=vector.context;
  if(p.derive(key,'field',context).toString('hex')!==vector.derivedKeyHex)throw Error('KDF_VECTOR');
  const result=await p.decrypt(key,context,{nonce:Buffer.from(vector.nonceHex,'hex'),ciphertext:Buffer.from(vector.ciphertextHex,'hex')});
  if(p.encode(result).toString('hex')!==vector.plaintextHex)throw Error('AEAD_VECTOR');
  const genesis=p.decode(Buffer.from(genesisVector.genesisHex,'hex'));
  await p.verify(genesis.body.owner.signingKey,'genesis',genesis.body,genesis.signature);
  if(p.fingerprint(genesis.body)!==genesisVector.fingerprint)throw Error('GENESIS_VECTOR');
  const encrypted=await p.encrypt(key,context,result);
  let rejected=false;
  try{await p.decrypt(key,{...context,objectId:'other'},encrypted);}catch{rejected=true;}
  if(!rejected)throw Error('AAD_SUBSTITUTION');
  key.fill(0);
}
function Probe(){
  const [status,setStatus]=useState('RUNNING');
  useEffect(()=>{checkProtocol().then(()=>{setStatus('CRYPTO_VERIFIED');console.info('THREAD_CRYPTO_PROBE_OK');},()=>{setStatus('CRYPTO_FAILED');console.info('THREAD_CRYPTO_PROBE_FAILED');});},[]);
  return <ScrollView contentContainerStyle={{padding:32,paddingTop:64}}>
    <Text style={{color:'#111',fontSize:24}}>Thread 암호 포맷 테스트</Text>
    <Text style={{color:'#111',marginTop:24}}>{status}</Text>
    <Text style={{color:'#333',marginTop:24}}>공개 synthetic 벡터만 사용합니다. 계정·할 일·키 저장소에는 접근하지 않습니다.</Text>
  </ScrollView>;
}
AppRegistry.registerComponent(appName,()=>Probe);
