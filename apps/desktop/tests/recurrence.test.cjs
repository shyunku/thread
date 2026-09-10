const {test}=require("node:test"),assert=require("node:assert/strict");
const {nextDue,occurrenceID}=require("../public/electron/e2ee/recurrence");
const time=Date.parse;
test("UTC recurrence preserves server month overflow, leap year and missed occurrences",()=>{
 for(const [start,now,period,want] of [
  ["2025-01-31T00:00:00Z","2025-02-01T00:00:00Z","month","2025-03-03T00:00:00Z"],
  ["2024-02-29T00:00:00Z","2024-03-01T00:00:00Z","year","2025-03-01T00:00:00Z"],
  ["2026-09-01T00:00:00Z","2026-09-05T12:00:00Z","day","2026-09-06T00:00:00Z"],
  ["2026-09-01T00:00:00Z","2026-09-08T00:00:00Z","week","2026-09-08T00:00:00Z"]
 ])assert.equal(nextDue(time(start),time(start),period,time(now)),time(want));
 assert.throws(()=>nextDue(0,1,"day",1));assert.throws(()=>nextDue(1,1,"hour",1));
 assert.throws(()=>nextDue(time("9999-12-31T00:00:00Z"),time("9999-12-31T00:00:00Z"),"day",time("9999-12-31T00:00:00Z")),/RANGE/);
});
test("PC timezone and daylight saving do not change the legacy UTC recurrence",()=>{
 const prior=process.env.TZ;
 try{
  for(const tz of ["UTC","Asia/Seoul","America/New_York"]){
   process.env.TZ=tz;
   assert.equal(nextDue(time("2026-03-07T07:30:00Z"),time("2026-03-07T07:30:00Z"),"day",time("2026-03-08T00:00:00Z")),time("2026-03-08T07:30:00Z"));
  }
 }finally{if(prior===undefined)delete process.env.TZ;else process.env.TZ=prior;}
});
test("occurrence identifiers match the Go golden value and separate accounts/generations",()=>{
 assert.equal(occurrenceID("fixture","task","0","task"),"772a1eb2-b5b4-5cc3-99c8-fe97b9447e29");
 assert.notEqual(occurrenceID("fixture","task","1","task"),occurrenceID("fixture","task","0","task"));
 assert.notEqual(occurrenceID("other","task","0","task"),occurrenceID("fixture","task","0","task"));
});
