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

// Periods (#109): start alerts and per-task overrides, opt-in with { periods: true } (the PC).
const {normalPeriodReminders,reminderText,DEFAULT_START_REMINDERS}=require("@thread/e2ee/src/model/reminders");
const period=(tid,start,end,extra)=>({tid,title:tid,due_date:end,start_offset:end-start,...extra});
const day0=(days)=>at(days,0,0);
const P={
 tasks:[
  period("work",at(0,15),at(0,17)),
  period("trip",day0(1),at(2,23,59)),
  period("off",at(0,16),at(0,18),{alert_start:"off",alert_end:"off"}),
  period("forced",at(1,9),at(1,10),{alert_start:"on",alert_end:"on"}),
  period("secret",at(1,11),at(1,12)),
  period("done",at(0,15),at(0,17),{done:true}),
  {tid:"orphan",title:"orphan",due_date:0,start_offset:3600000,alert_end:"on"},
 ],
 categories:[{cid:"s",title:"일기",secret:true}],
 relations:[{tid:"secret",cid:"s"}],
};
const ALL={enabled:true,before:true,minutes:10,due:true,startBefore:true,startMinutes:5,startAt:true};

test("without periods the plan is the one from before #109: no start alerts, overrides ignored (the phone)",()=>{
 const ids=planReminders(P,ALL,{now:NOW}).map(p=>p.id);
 assert.deepEqual(ids,["work:before","work:due","off:before","off:due","forced:before","forced:due","secret:before","secret:due"]);
 // The old settings shape and normalReminders stay as they were.
 assert.deepEqual(Object.keys(normalReminders(ALL)).sort(),["before","due","enabled","minutes"]);
 assert.deepEqual(planReminders(P,{enabled:false,before:true,minutes:10,due:true},{now:NOW}),[]);
 assert.deepEqual(planReminders(P,{...ALL,enabled:true,before:false,due:false},{now:NOW}),[]);
 assert.ok(planReminders(P,ALL,{now:NOW}).every(p=>!("start" in p)&&!("override" in p)));
});

test("with periods: start alerts for timed starts, distinct ids, the end as before, secret titles hidden",()=>{
 const plan=planReminders(P,ALL,{now:NOW,periods:true});
 assert.deepEqual(plan.map(p=>p.id),[
  "work:start-before","work:start","work:before","work:due",
  "forced:start-before","forced:start","forced:before","forced:due",
  "secret:start-before","secret:start","secret:before","secret:due",
 ]);
 const s=plan.find(p=>p.id==="work:start-before");
 assert.deepEqual([s.kind,s.at,s.start,s.due,s.minutes,s.title],["start-before",at(0,14,55),at(0,15),at(0,17),5,"work"]);
 assert.equal(plan.find(p=>p.id==="work:start").at,at(0,15));
 assert.ok(plan.filter(p=>p.tid==="secret").every(p=>p.title===null));
 // A date-only start (00:00) and a date-only end (23:59) ring nothing: "trip".
 assert.equal(plan.some(p=>p.tid==="trip"),false);
 assert.deepEqual(normalPeriodReminders(undefined),{...DEFAULT_REMINDERS,...DEFAULT_START_REMINDERS});
 // Defaults: start 10분 전 on, 정각 off.
 assert.deepEqual(planReminders({tasks:[P.tasks[0]]},undefined,{now:NOW,periods:true}).map(p=>p.id),["work:start-before","work:before"]);
});

test("per-task overrides: off rings nothing, on rings the settings' alerts or once N minutes before",()=>{
 const none={enabled:true,before:false,minutes:30,due:false,startBefore:false,startMinutes:15,startAt:false};
 assert.deepEqual(planReminders(P,none,{now:NOW,periods:true}).map(p=>[p.id,p.at]),[["forced:start-before",at(1,8,45)],["forced:before",at(1,9,30)]]);
 // Reminders off entirely: only the forced ones, once.
 assert.deepEqual(planReminders(P,{...ALL,enabled:false},{now:NOW,periods:true}).map(p=>[p.id,p.minutes,p.override]),
  [["forced:start-before",5,"on"],["forced:before",10,"on"]]);
 // "on" with alerts on in the settings: the same as following them.
 assert.deepEqual(planReminders({tasks:[P.tasks[3]]},ALL,{now:NOW,periods:true}).map(p=>p.id),["forced:start-before","forced:start","forced:before","forced:due"]);
 // A side that cannot ring (no time) stays silent even when turned on.
 assert.deepEqual(planReminders({tasks:[period("t",day0(1),at(1,23,59),{alert_start:"on",alert_end:"on"})]},ALL,{now:NOW,periods:true}),[]);
 // An unknown override value follows the settings.
 assert.deepEqual(planReminders({tasks:[period("u",at(0,15),at(0,17),{alert_end:"maybe"})]},none,{now:NOW,periods:true}),[]);
});

test("start alert wording, with and without content",()=>{
 const item={kind:"start-before",due:at(0,17),start:at(0,15),minutes:10,title:"회의"};
 assert.deepEqual(reminderText(item),{title:"회의",body:"오후 3:00부터 · 10분 뒤 시작"});
 assert.deepEqual(reminderText({...item,kind:"start",minutes:0},{timeFormat:"24"}),{title:"회의",body:"지금 시작해요 · 15:00"});
 assert.deepEqual(reminderText({...item,minutes:60,title:null}),{title:"할 일 1개가 1시간 뒤 시작해요",body:""});
 assert.deepEqual(reminderText({...item,kind:"start"},{hidden:true}),{title:"할 일 1개가 지금 시작해요",body:"앱 잠금을 풀면 볼 수 있어요"});
 // The end texts are unchanged.
 assert.deepEqual(reminderText({kind:"before",due:at(0,15),minutes:10,title:"회의"}),{title:"회의",body:"오후 3:00까지 · 10분 남음"});
});
