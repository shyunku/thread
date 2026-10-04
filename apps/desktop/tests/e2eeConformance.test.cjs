const {test}=require("node:test"),assert=require("node:assert/strict");
require("../public/electron/e2ee/platform");
const {runConformance}=require("@thread/e2ee/test/conformance");

test("desktop platform reproduces the shared E2EE conformance fixtures",async()=>{
 assert.deepEqual(await runConformance(),[]);
});
