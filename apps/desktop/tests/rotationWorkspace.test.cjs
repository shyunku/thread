const {test}=require("node:test"),assert=require("node:assert/strict");
const {connectedDevices,pcModel}=require("../public/electron/e2ee/rotationWorkspace");
const {flags}=require("@thread/e2ee/src/model/deviceNames");
const owner={id:"owner",role:"write",signingKey:Buffer.alloc(32),encryptionKey:Buffer.alloc(32)};
const laptop={id:"laptop",role:"write",signingKey:Buffer.alloc(32,1),encryptionKey:Buffer.alloc(32,1)};
const phone={id:"phone",role:"read",signingKey:Buffer.alloc(32,2),encryptionKey:Buffer.alloc(32,2)};
const history={current:{devices:new Map([["owner",owner],["laptop",laptop],["phone",phone]])},records:new Map([
 [1,{body:{operation:"add",device:laptop,expiresAt:1_800_000_600_000}}],
 [2,{body:{operation:"revoke",deviceId:"old"}}],
 [3,{body:{envelopes:[]}}],
])};
test("connected devices expose role, ownership and approximate signed add time only",()=>{
 const devices=connectedDevices(history,"owner",[],{ownModel:"Windows PC"});
 assert.deepEqual(devices,[
  {id:"owner",role:"write",own:true,addedAt:null,name:"Windows PC",model:"Windows PC",shortId:"OWNE",showId:false,canRename:false},
  {id:"laptop",role:"write",own:false,addedAt:1_800_000_000_000,name:null,model:null,shortId:"LAPT",showId:true,canRename:false},
  {id:"phone",role:"read",own:false,addedAt:null,name:null,model:null,shortId:"PHON",showId:true,canRename:false},
 ]);
 // No key material reaches the renderer.
 for(const device of devices)assert.deepEqual(Object.keys(device).sort(),["addedAt","canRename","id","model","name","own","role","shortId","showId"]);
});
test("device names join current members only; the short id shows when names repeat (#77)",t=>{
 const names=[{deviceId:"laptop",name:"Windows PC",model:"Windows PC"},{deviceId:"phone",name:"Galaxy S24",model:"Galaxy S24"},{deviceId:"removed",name:"옛 노트북",model:null}];
 const devices=connectedDevices(history,"owner",names,{ownModel:"Windows PC"});
 assert.deepEqual(devices.map(d=>[d.id,d.name,d.showId]),[["owner","Windows PC",true],["laptop","Windows PC",true],["phone","Galaxy S24",false]]);
 assert.equal(devices.some(d=>d.name==="옛 노트북"),false);
 // A name of its own wins over the model.
 const renamed=connectedDevices(history,"owner",[{deviceId:"owner",name:"회사 노트북",model:"Windows PC"}],{ownModel:"Windows PC"});
 assert.equal(renamed[0].name,"회사 노트북");
 assert.equal(renamed[0].showId,false);
 // Renaming needs the shared switch and a write device.
 t.after(()=>{flags.DEVICE_NAMES_WRITE=false;});
 flags.DEVICE_NAMES_WRITE=true;
 assert.equal(connectedDevices(history,"owner").every(d=>d.canRename),true);
 assert.equal(connectedDevices(history,"phone").some(d=>d.canRename),false);
});
test("the PC's default name is the kind of computer, never the host name",()=>{
 assert.equal(pcModel("win32"),"Windows PC");
 assert.equal(pcModel("darwin"),"Mac");
});
