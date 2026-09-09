const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const ts=require('../node_modules/typescript');
const file=path.resolve(__dirname,'../src/sync/keyProtection.ts');
const compiled=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true},reportDiagnostics:true});
assert.equal(compiled.diagnostics.length,0);const mod=new Module(file,module);mod.filename=file;mod.paths=Module._nodeModulePaths(path.dirname(file));mod._compile(compiled.outputText,file);
const {createMobileKeyProtection}=mod.exports;
function fixture(){const entries=new Map(),calls=[];let level=1;
 const api={SECURITY_LEVEL:{SECURE_SOFTWARE:1,SECURE_HARDWARE:2,ANY:0},ACCESSIBLE:{WHEN_PASSCODE_SET_THIS_DEVICE_ONLY:'device-only'},ACCESS_CONTROL:{BIOMETRY_CURRENT_SET_OR_DEVICE_PASSCODE:'presence'},STORAGE_TYPE:{AES_GCM:'authenticated-gcm'},
  getSecurityLevel:async()=>level,hasGenericPassword:async({service})=>entries.has(service),
  setGenericPassword:async(username,password,options)=>{calls.push(options);entries.set(options.service,{username,password});return {service:options.service};},
  getGenericPassword:async options=>{calls.push(options);return entries.get(options.service)||false;}};
 return {entries,calls,api,provider:createMobileKeyProtection(api,'android'),insecure:()=>{level=0;}};
}
const scope={environment:'development',accountId:'fixture',vaultId:'vault'};
test('requires authenticated secure storage; preserves existing keys and scope',async()=>{
 const f=fixture(),key=Buffer.alloc(32,5);await f.provider.create(scope,key);assert.deepEqual(await f.provider.open(scope),key);
 assert.ok(f.calls.every(o=>o.storage==='authenticated-gcm'&&o.accessControl==='presence'));
 await assert.rejects(f.provider.create(scope,Buffer.alloc(32,6)),/EXISTS/);assert.deepEqual(await f.provider.open(scope),key);
 await assert.rejects(f.provider.open({...scope,environment:'production'}),/UNAVAILABLE/);
 f.insecure();await assert.rejects(f.provider.open(scope),/SECURE_STORAGE_UNAVAILABLE/);
});
test('cancelled, missing and replaced key envelopes fail without clearing storage',async()=>{
 const f=fixture();await f.provider.create(scope,Buffer.alloc(32,7));const [service,entry]=[...f.entries][0];
 entry.password=entry.password.replace('fixture','other');await assert.rejects(f.provider.open(scope),/DAMAGED/);
 f.api.getGenericPassword=async()=>{throw Error('native cancellation')};await assert.rejects(f.provider.open(scope),/UNAVAILABLE/);assert.equal(f.entries.has(service),true);
});
