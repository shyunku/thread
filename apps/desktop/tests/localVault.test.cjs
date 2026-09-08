const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { createHash, randomBytes, createCipheriv, createDecipheriv } = require("node:crypto");
const { LocalVault } = require("../public/electron/e2ee/localVault");
const { encode } = require("../public/electron/e2ee/protocol");
const scope = { environment:"development", accountId:"fixture-a", vaultId:"vault-a" };
// Test-only authenticated stand-in. Actual DPAPI is tested separately in Electron.
function protector() {
  const osKey = randomBytes(32);
  return {
    protect(key, context) {
      const nonce = randomBytes(12), cipher = createCipheriv("aes-256-gcm", osKey, nonce);
      cipher.setAAD(Buffer.from(JSON.stringify(context)));
      const encrypted = Buffer.concat([cipher.update(key), cipher.final()]);
      return Buffer.concat([nonce, cipher.getAuthTag(), encrypted]);
    },
    unprotect(data, context) {
      const cipher = createDecipheriv("aes-256-gcm", osKey, data.subarray(0,12));
      cipher.setAAD(Buffer.from(JSON.stringify(context)));
      cipher.setAuthTag(data.subarray(12,28));
      return Buffer.concat([cipher.update(data.subarray(28)),cipher.final()]);
    },
  };
}
const directory=(base,s)=>path.join(base,createHash("sha256").update(encode(s)).digest("hex"));
function fixture(t) {
  const baseDirectory=fs.mkdtempSync(path.join(os.tmpdir(),"thread-local-vault-"));
  t.after(()=>fs.rmSync(baseDirectory,{recursive:true,force:true}));
  const provider=protector();
  return {baseDirectory,provider,vault:new LocalVault({baseDirectory,scope,protector:provider})};
}
test("persistent LDK reopens encrypted records through a new repository instance",t=>{
  const {baseDirectory,provider,vault}=fixture(t);vault.create();
  let store=vault.open();
  store.put("outbox","one",{title:"SYNTHETIC_LOCAL_VAULT_PRIVATE"});store.close();
  store=new LocalVault({baseDirectory,scope,protector:provider}).open();
  try {assert.equal(store.get("outbox","one").title,"SYNTHETIC_LOCAL_VAULT_PRIVATE");}
  finally {store.close();}
  assert.throws(()=>vault.create(),/EEXIST/);
});
test("missing key requires recovery and preserves existing database bytes",t=>{
  const {baseDirectory,vault}=fixture(t);vault.create();
  const dir=directory(baseDirectory,scope), filename=path.join(dir,"vault.db");
  const before=fs.readFileSync(filename);
  fs.renameSync(path.join(dir,"ldk.protected"),path.join(dir,"ldk.fixture-backup"));
  assert.throws(()=>vault.open(),/RECOVERY_REQUIRED/);
  assert.throws(()=>vault.create(),/EEXIST/);
  assert.deepEqual(fs.readFileSync(filename),before);
});
test("partial initialization is not reset or silently treated as ready",t=>{
  const {baseDirectory,vault}=fixture(t);vault.create();
  const dir=directory(baseDirectory,scope);
  fs.renameSync(path.join(dir,"ready"),path.join(dir,"ready.fixture-backup"));
  assert.throws(()=>vault.open(),/RECOVERY_REQUIRED/);
  assert.throws(()=>vault.create(),/EEXIST/);
  assert.ok(fs.existsSync(path.join(dir,"vault.db")));
});
test("account/environment/vault are isolated and replacing a key file is rejected",t=>{
  const {baseDirectory,provider,vault}=fixture(t);vault.create();
  for(const changed of [{environment:"production"},{accountId:"other"},{vaultId:"other"}])
    assert.throws(()=>new LocalVault({baseDirectory,scope:{...scope,...changed},protector:provider}).open(),/RECOVERY_REQUIRED/);
  const otherScope={...scope,accountId:"other"};
  const other=new LocalVault({baseDirectory,scope:otherScope,protector:provider});other.create();
  fs.copyFileSync(path.join(directory(baseDirectory,scope),"ldk.protected"),path.join(directory(baseDirectory,otherScope),"ldk.protected"));
  assert.throws(()=>other.open());
});
test("unavailable OS protection creates no files",t=>{
  const {baseDirectory}=fixture(t);
  const vault=new LocalVault({baseDirectory,scope,protector:{protect(){throw Error("KEYSTORE_UNAVAILABLE");}}});
  assert.throws(()=>vault.create(),/KEYSTORE_UNAVAILABLE/);
  assert.deepEqual(fs.readdirSync(baseDirectory),[]);
});
