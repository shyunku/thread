const {randomBytes,createHash}=require("node:crypto");
const p=require("./protocol");
const m=require("./membership");
const MAX_REQUEST=2048, MAX_TRANSFER=512*1024;
const id=value=>typeof value==="string"&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
const digest=value=>typeof value==="string"&&/^[a-f0-9]{64}$/.test(value);
function check(value){if(!value)throw Error("INVALID_PAIRING_FILE");}
function requestFingerprint(record){return createHash("sha256").update(p.encode([p.SUITE,"pair-request",record])).digest("hex");}
async function verifyRequest(record,now=Date.now()){
 check(record&&record.body&&Buffer.isBuffer(record.signature));const b=record.body,d=b.device;
 check(Object.keys(record).length===2&&Object.keys(b).length===8&&b.schema===1&&b.kind==="pair-request"&&id(b.vaultId)&&digest(b.genesisFingerprint)&&id(b.requestId));
 check(Buffer.isBuffer(b.nonce)&&b.nonce.length===32&&Number.isSafeInteger(b.expiresAt)&&b.expiresAt>now&&b.expiresAt<=now+600000);
 check(d&&Object.keys(d).length===5&&id(d.id)&&["read","write"].includes(d.role)&&typeof d.canAuthorizeDevices==="boolean"&&Buffer.isBuffer(d.signingKey)&&d.signingKey.length===32&&Buffer.isBuffer(d.encryptionKey)&&d.encryptionKey.length===32);
 check(p.encode(record).length<=MAX_REQUEST);
 await p.verify(d.signingKey,"pair-request",b,record.signature);return record;
}
async function createRequest({vaultId,genesisFingerprint,device,role="read",canAuthorizeDevices=false,now=Date.now()}){
 const body={schema:1,kind:"pair-request",vaultId,genesisFingerprint,requestId:randomBytes(16).toString("hex"),nonce:randomBytes(32),expiresAt:now+600000,
  device:{id:randomBytes(16).toString("hex"),role,canAuthorizeDevices,signingKey:device.signing.publicKey,encryptionKey:device.encryption.publicKey}};
 const record={body,signature:await p.sign(device.signing.privateKey,"pair-request",body)};
 await verifyRequest(record,now);return record;
}
function toRequestFile(record){const encoded=p.encode(record);check(encoded.length<=MAX_REQUEST);return encoded;}
async function fromRequestFile(bytes,now){check(Buffer.isBuffer(bytes)&&bytes.length<=MAX_REQUEST);return verifyRequest(p.decode(bytes),now);}
function toQR(record){return "thread-pair:v1:"+toRequestFile(record).toString("base64url");}
async function fromQR(value,now){
 check(typeof value==="string"&&value.length<=2800&&value.startsWith("thread-pair:v1:"));
 const encoded=value.slice(15);check(/^[A-Za-z0-9_-]+$/.test(encoded));const bytes=Buffer.from(encoded,"base64url");check(bytes.toString("base64url")===encoded);return fromRequestFile(bytes,now);
}
// Returns a proposal, not a committed approval. Caller must CAS-persist the
// event before publishing the transfer. No key is sent to a server in plaintext.
async function proposeApproval({request,state,authority,authorityId,keyring,confirmedFingerprint,reauthenticate,now=()=>Date.now()}){
 await verifyRequest(request,now());check(confirmedFingerprint===requestFingerprint(request));
 if(await reauthenticate()!==true)throw Error("REAUTH_REQUIRED");
 await verifyRequest(request,now());check(request.body.vaultId===state.vaultId&&request.body.genesisFingerprint===state.genesisFingerprint);
 check(Number.isSafeInteger(state.revision)&&state.revision>=0&&state.revision<Number.MAX_SAFE_INTEGER);
 const body={vaultId:state.vaultId,revision:state.revision+1,previous:state.head,signer:authorityId,operation:"add",device:request.body.device,expiresAt:request.body.expiresAt,requestId:request.body.requestId};
 const event={body,signature:await p.sign(authority.signing.privateKey,"membership",body)};
 const next=await m.applyMembership(state,event);
 const payload={schema:1,vaultId:state.vaultId,genesisFingerprint:request.body.genesisFingerprint,keyring,checkpoint:{revision:next.revision,head:next.head}};
 const sealed=await p.seal(request.body.device.encryptionKey,authority.signing.privateKey,request.body,payload);
 const transfer={schema:1,kind:"key-transfer",request,event,sealed};
 check(p.encode(transfer).length<=MAX_TRANSFER);return {event,next,transfer};
}
function toTransferFile(transfer){const bytes=p.encode(transfer);check(bytes.length<=MAX_TRANSFER);return bytes;}
async function acceptTransfer({bytes,request,device,state,genesisFingerprint,now=Date.now()}){
 check(Buffer.isBuffer(bytes)&&bytes.length<=MAX_TRANSFER);await verifyRequest(request,now);
 check(request.body.genesisFingerprint===genesisFingerprint&&state.genesisFingerprint===genesisFingerprint&&request.body.vaultId===state.vaultId);
 check(request.body.device.signingKey.equals(device.signing.publicKey)&&request.body.device.encryptionKey.equals(device.encryption.publicKey));
 const transfer=p.decode(bytes);check(transfer.schema===1&&transfer.kind==="key-transfer"&&Object.keys(transfer).length===5);
 check(p.encode(transfer.request).equals(p.encode(request)));
 check(transfer.event.body.operation==="add"&&p.encode(transfer.event.body.device).equals(p.encode(request.body.device)));
 check(transfer.event.body.expiresAt===request.body.expiresAt&&transfer.event.body.requestId===request.body.requestId);
 const signer=state.devices.get(transfer.event.body.signer);check(signer?.canAuthorizeDevices);
 const next=await m.applyMembership(state,transfer.event);
 const payload=await p.unseal(device.encryption,signer.signingKey,transfer.sealed,request.body,now);
 check(payload.schema===1&&payload.vaultId===state.vaultId&&payload.genesisFingerprint===genesisFingerprint&&payload.checkpoint.revision===next.revision&&payload.checkpoint.head===next.head);
 return {state:next,keyring:payload.keyring};
}
module.exports={createRequest,verifyRequest,requestFingerprint,toRequestFile,fromRequestFile,toQR,fromQR,proposeApproval,toTransferFile,acceptTransfer};
