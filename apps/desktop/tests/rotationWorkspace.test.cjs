const {test}=require("node:test"),assert=require("node:assert/strict");
const {connectedDevices}=require("../public/electron/e2ee/rotationWorkspace");
test("connected devices expose role, ownership and approximate signed add time only",()=>{
 const owner={id:"owner",role:"write",signingKey:Buffer.alloc(32),encryptionKey:Buffer.alloc(32)};
 const laptop={id:"laptop",role:"write",signingKey:Buffer.alloc(32,1),encryptionKey:Buffer.alloc(32,1)};
 const phone={id:"phone",role:"read",signingKey:Buffer.alloc(32,2),encryptionKey:Buffer.alloc(32,2)};
 const history={current:{devices:new Map([["owner",owner],["laptop",laptop],["phone",phone]])},records:new Map([
  [1,{body:{operation:"add",device:laptop,expiresAt:1_800_000_600_000}}],
  [2,{body:{operation:"revoke",deviceId:"old"}}],
  [3,{body:{envelopes:[]}}],
 ])};
 const devices=connectedDevices(history,"owner");
 assert.deepEqual(devices,[
  {id:"owner",role:"write",own:true,addedAt:null},
  {id:"laptop",role:"write",own:false,addedAt:1_800_000_000_000},
  {id:"phone",role:"read",own:false,addedAt:null},
 ]);
 // No key material reaches the renderer.
 for(const device of devices)assert.deepEqual(Object.keys(device).sort(),["addedAt","id","own","role"]);
});
