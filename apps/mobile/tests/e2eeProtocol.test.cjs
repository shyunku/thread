const test=require('node:test'),assert=require('node:assert/strict');
const desktop=require('../../desktop/public/electron/e2ee/protocol');
const {createProtocol}=require('../src/sync/e2ee/protocolFactory');
const sodium=require('../../desktop/node_modules/libsodium-wrappers');
const {createMembership}=require('../../desktop/public/electron/e2ee/membershipCore');
const {createSyncProtocol}=require('../../desktop/public/electron/e2ee/syncProtocolCore');
const {hkdf}=require('@noble/hashes/hkdf'),{sha256}=require('@noble/hashes/sha256');
async function mobile(){return createProtocol({sodium,cbor:await import('cborg'),hkdf,sha256});}
const context={vaultId:'fixture',vaultEpoch:'1',objectId:'one',fieldSlot:7,keyGeneration:1,mutationId:'mutation',deviceId:'owner'};
test('mobile CBOR/HKDF matches desktop; ciphertext and signatures cross both directions',async()=>{
 const p=await mobile(),key=Buffer.alloc(32,7),value={title:'synthetic 한글',nested:[1,-1,256,true,null],bytes:Buffer.from([0,255])};
 assert.deepEqual(p.encode(value),desktop.encode(value));assert.deepEqual(p.decode(desktop.encode(value)),value);
 assert.deepEqual(p.derive(key,'field',context),desktop.derive(key,'field',context));
 assert.deepEqual(await p.decrypt(key,context,await desktop.encrypt(key,context,value)),value);
 assert.deepEqual(await desktop.decrypt(key,context,await p.encrypt(key,context,value)),value);
 const device=await desktop.createDevice();
 const sig=await desktop.sign(device.signing.privateKey,'fixture',value);
 assert.deepEqual(await p.sign(device.signing.privateKey,'fixture',value),sig);
 await p.verify(device.signing.publicKey,'fixture',value,sig);
 assert.equal(p.fingerprint(value),desktop.fingerprint(value));
 const encrypted=await desktop.encrypt(key,context,value);
 for(const field of Object.keys(context)){
  const changed={...context,[field]:typeof context[field]==='number'?context[field]+1:context[field]+'-other'};
  await assert.rejects(p.decrypt(key,changed,encrypted));
 }
 const damaged={...encrypted,ciphertext:Buffer.from(encrypted.ciphertext)};damaged.ciphertext[0]^=1;
 await assert.rejects(p.decrypt(key,context,damaged));
});

test('mobile and desktop share v1/v2 mutation verification and retained encrypted tombstones',async()=>{
 const p=await mobile(),membership=createMembership(p),sync=createSyncProtocol(p,membership),desktopSync=require('../../desktop/public/electron/e2ee/syncProtocol');
 const device=await desktop.createDevice(),body={schema:1,vaultId:'fixture',recoveryKey:Buffer.alloc(32,8),owner:{id:'owner',role:'write',canAuthorizeDevices:true,signingKey:device.signing.publicKey,encryptionKey:device.encryption.publicKey}};
 const state=await membership.verifyGenesis({body,signature:await desktop.sign(device.signing.privateKey,'genesis',body)},desktop.fingerprint(body));
 const fixture={state,device,deviceId:'owner',epoch:'1',key:Buffer.alloc(32,4),counter:'1',mutationId:'migration',schema:2,changes:[{objectId:'deleted',baseVersion:'0',deleted:true,fields:[{slot:0,value:{title:'preserved',deleted_at:1}}]}]};
 const fromDesktop=await desktopSync.createBatch(fixture),fromMobile=await sync.createBatch(fixture);
 assert.deepEqual(await sync.decryptBatch(fromDesktop,fixture),await desktopSync.decryptBatch(fromMobile,fixture));
 assert.equal((await sync.decryptBatch(fromDesktop,fixture))[0].deleted,true);
 await assert.rejects(sync.createBatch({...fixture,schema:1}));
 fromDesktop.body.operations[0].fields[0].ciphertext[0]^=1;
 await assert.rejects(sync.decryptBatch(fromDesktop,fixture));
});
test('mobile rejects duplicate keys, tags, depth, floats and trailing bytes',async()=>{
 const p=await mobile();
 for(const hex of ['a2616101616102','d8184100','9f01ff','fa3fc00000','0101','a16b636f6e7374727563746f7201'])
  assert.throws(()=>p.decode(Buffer.from(hex,'hex')));
 assert.throws(()=>p.decode(Buffer.concat([Buffer.alloc(26,0x81),Buffer.from([1])])));
 assert.deepEqual(p.decode(p.encode({toString:'allowed'})),{toString:'allowed'});
});
test('sealed keyring files interoperate and reject substitution',async()=>{
 const p=await mobile(),sender=await desktop.createDevice(),recipient=await p.createDevice();
 const request={expiresAt:Date.now()+60000,id:'fixture'},ring={key:Buffer.alloc(32,9)};
 const desktopFile=await desktop.seal(recipient.encryption.publicKey,sender.signing.privateKey,request,ring);
 assert.deepEqual(await p.unseal(recipient.encryption,sender.signing.publicKey,desktopFile,request),ring);
 const mobileFile=await p.seal(recipient.encryption.publicKey,sender.signing.privateKey,request,ring);
 assert.deepEqual(await desktop.unseal(recipient.encryption,sender.signing.publicKey,mobileFile,request),ring);
 await assert.rejects(p.unseal(recipient.encryption,sender.signing.publicKey,mobileFile,{...request,id:'changed'}));
});
