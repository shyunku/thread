const {test}=require("node:test"),assert=require("node:assert/strict");
const {planReminders,normalReminders,DEFAULT_REMINDERS}=require("@thread/e2ee/src/model/reminders");

// Synthetic lists; local times.
const NOW=new Date(2026,9,24,14,0).getTime();
const at=(days,h,m=0)=>{const d=new Date(NOW);d.setDate(d.getDate()+days);d.setHours(h,m,0,0);return d.getTime();};
const lists={
 tasks:[
  {tid:"meet",title:"회의",due_date:at(0,15)},
  {tid:"soon",title:"곧",due_date:at(0,14,5)},
  {tid:"eod",title:"하루 끝",due_date:at(0,23,59)},
  {tid:"done",title:"끝남",due_date:at(0,16),done:true},
  {tid:"none",title:"기한 없음",due_date:0},
  {tid:"past",title:"지남",due_date:at(-1,9)},
  {tid:"diary",title:"비밀 일",due_date:at(1,9)},
 ],
 categories:[{cid:"work",title:"업무"},{cid:"secret",title:"일기",secret:true}],
 relations:[{tid:"meet",cid:"work"},{tid:"diary",cid:"secret"}],
};

test("default: 10 minutes before, open tasks with a chosen time, secret ones without a title",()=>{
 assert.deepEqual(normalReminders(undefined),{...DEFAULT_REMINDERS});
 const plan=planReminders(lists,undefined,{now:NOW});
 assert.deepEqual(plan.map(p=>p.id),["meet:before","diary:before"]);
 assert.equal(plan[0].at,at(0,14,50));
 assert.equal(plan[0].title,"회의");
 assert.equal(plan[1].title,null);
});

test("both kinds, past times dropped, the soonest kept under a limit",()=>{
 const plan=planReminders(lists,{before:true,minutes:5,due:true},{now:NOW});
 // soon:before (14:00) is not after now; soon:due at 14:05 is.
 assert.deepEqual(plan.map(p=>p.id),["soon:due","meet:before","meet:due","diary:before","diary:due"]);
 assert.deepEqual(planReminders(lists,{due:true},{now:NOW,limit:2}).map(p=>p.id),["soon:due","meet:before"]);
});

test("off, or both kinds off, plans nothing; bad settings fall back to the defaults",()=>{
 assert.deepEqual(planReminders(lists,{enabled:false},{now:NOW}),[]);
 assert.deepEqual(planReminders(lists,{before:false,due:false},{now:NOW}),[]);
 assert.deepEqual(normalReminders({minutes:7,before:"yes"}),{...DEFAULT_REMINDERS});
});
