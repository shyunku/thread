const {test}=require("node:test"),assert=require("node:assert/strict");
require("../public/electron/e2ee/platform");
const {v4,v5}=require("@thread/e2ee/src/uuid");
const uuid=require("uuid");

test("shared uuid v5 matches the uuid package (recurring occurrence ids)",()=>{
 const oid="6ba7b812-9dad-11d1-80b4-00c04fd430c8";
 for(const name of ["","a",'["acct","task",1,"task"]',"한글 이름\u2028"])assert.equal(v5(name,oid),uuid.v5(name,oid));
});
test("shared uuid v4 has the RFC 4122 version and variant",()=>{
 for(let i=0;i<50;i++)assert.match(v4(),/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
