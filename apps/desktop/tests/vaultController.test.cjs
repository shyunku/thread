const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { createVaultController } = require("../public/electron/e2ee/vaultController");
function fixture(t, overrides = {}) {
  let opens = 0, closes = 0, clears = 0;
  const power = new EventEmitter(); power.getSystemIdleTime = () => 0;
  const store = () => { opens++; return {close(){closes++;}, get(){return "synthetic";}}; };
  const controller = createVaultController({
    vault: {open:store, async openWithPassword(p){if(p !== "fixture password")throw Error("WRONG_PASSWORD");return store();}},
    osAuth:{async verify(){return true;}}, getWindow:()=>({}),
    clearRenderer(){clears++;}, powerMonitor:power, ...overrides,
  });
  t.after(()=>controller.dispose());
  return {controller,power,counts:()=>({opens,closes,clears})};
}
test("explicit methods unlock; screen lock and suspend close DB and clear renderer", async t=>{
  const {controller:c,power,counts}=fixture(t);
  assert.throws(()=>c.use(()=>{}),/LOCKED/);
  assert.equal(await c.unlock("os"),true);
  assert.equal(c.use(db=>db.get()),"synthetic");
  power.emit("lock-screen"); assert.throws(()=>c.use(()=>{}),/LOCKED/);
  await c.unlock("password","fixture password"); power.emit("suspend");
  assert.deepEqual(counts(),{opens:2,closes:2,clears:2});
});
test("cancelled OS authentication never opens DB or falls back to password", async t=>{
  const {controller:c,counts}=fixture(t,{osAuth:{async verify(){return false;}}});
  await assert.rejects(c.unlock("os"),/REAUTH_REQUIRED/);
  await assert.rejects(c.unlock("password","wrong"),/WRONG_PASSWORD/);
  await assert.rejects(c.unlock("pin","123456"),/INVALID_UNLOCK_METHOD/);
  assert.equal(counts().opens,0);
});
test("lock during OS authentication cancels late success and duplicate requests", async t=>{
  let finish;
  const {controller:c,counts}=fixture(t,{osAuth:{verify:()=>new Promise(r=>{finish=r;})}});
  const pending=c.unlock("os");
  await assert.rejects(c.unlock("password","fixture password"),/IN_PROGRESS/);
  c.lock(); finish(true);
  await assert.rejects(pending,/UNLOCK_CANCELLED/); assert.equal(counts().opens,0);
});
test("dispose during password opening closes late DB and removes monitor listeners", async t=>{
  let finish, closed=0;
  const {controller:c,power}=fixture(t,{vault:{openWithPassword:()=>new Promise(r=>{finish=r;})}});
  const pending=c.unlock("password","fixture password"); await Promise.resolve();
  c.dispose(); finish({close(){closed++;}});
  await assert.rejects(pending,/UNLOCK_CANCELLED/);
  assert.equal(closed,1); assert.equal(power.listenerCount("suspend"),0);
  await assert.rejects(c.unlock("os"),/SESSION_CLOSED/);
});
test("five minute idle boundary closes an unlocked store", async t=>{
  t.mock.timers.enable({apis:["setInterval"]});
  const {controller:c,power,counts}=fixture(t);
  await c.unlock("os");
  power.getSystemIdleTime=()=>299; t.mock.timers.tick(1000);
  assert.equal(c.use(db=>db.get()),"synthetic");
  power.getSystemIdleTime=()=>300; t.mock.timers.tick(1000);
  assert.throws(()=>c.use(()=>{}),/LOCKED/);assert.equal(counts().closes,1);
  c.dispose();t.mock.timers.reset();
});
