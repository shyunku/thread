const {test,mock}=require("node:test"),assert=require("node:assert/strict");
const {RemindersService,LATE_MS}=require("../public/electron/service/reminders.service");

// Synthetic lists and a fake Electron Notification; no real notifications.
const NOW=new Date(2026,9,24,14,0).getTime();
const at=(h,m=0)=>{const d=new Date(NOW);d.setHours(h,m,0,0);return d.getTime();};
function setup(t,settings={enabled:true,before:true,minutes:10,due:false}){
 mock.timers.enable({apis:["setTimeout","Date"],now:NOW});
 t.after(()=>mock.timers.reset());
 const shown=[];
 class Notification{
  static isSupported(){return true;}
  constructor(o){this.o=o;this.h={};}
  on(e,f){this.h[e]=f;}
  show(){shown.push(this);}
 }
 const sent=[],window={isDestroyed:()=>false,isMinimized:()=>false,show(){},focus(){},webContents:{send:(...a)=>sent.push(a)}};
 const svc=new RemindersService({electron:()=>({Notification}),settings:()=>settings,now:()=>Date.now()});
 svc.inject({windowService:{mainWindow:window}});
 return {svc,shown,sent,settings};
}
const lists={
 tasks:[{tid:"meet",title:"회의",due_date:at(15)},{tid:"diary",title:"비밀 일",due_date:at(16)}],
 categories:[{cid:"s",title:"일기",secret:true}],
 relations:[{tid:"diary",cid:"s"}],
};

test("shows each reminder at its time; secret ones without content; a click opens the task",t=>{
 const {svc,shown,sent}=setup(t);
 svc.update(lists);
 mock.timers.tick(at(14,50)-NOW-1);
 assert.equal(shown.length,0);
 mock.timers.tick(1);
 assert.deepEqual(shown.map(n=>[n.o.title,n.o.body]),[["회의","10분 뒤 기한 · 오후 3:00"]]);
 shown[0].h.click();
 assert.deepEqual(sent[0],["reminder/open",null,{success:true,data:{tid:"meet"}}]);
 mock.timers.tick(at(15,50)-at(14,50));
 assert.deepEqual([shown[1].o.title,shown[1].o.body],["Thread","할 일 1개의 기한이 10분 남았어요"]);
});

test("locked: the titles go, reminders come without content and a click does not open a task",t=>{
 const {svc,shown,sent}=setup(t);
 svc.update(lists);
 svc.lock();
 assert.ok(svc.plan.every(p=>p.title===null));
 mock.timers.tick(at(14,50)-NOW);
 assert.deepEqual([shown[0].o.title,shown[0].o.body],["Thread","할 일 1개의 기한이 10분 남았어요"]);
 shown[0].h.click();
 assert.equal(sent.length,0);
});

test("turning reminders off while locked clears them; one found too late after a sleep is skipped",t=>{
 const {svc,shown,settings}=setup(t);
 svc.update(lists);svc.lock();
 settings.enabled=false;svc.settingsChanged();
 assert.equal(svc.plan.length,0);
 settings.enabled=true;svc.update(lists);
 // The PC slept past 14:50 by more than the late window.
 mock.timers.setTime(at(14,50)+LATE_MS+1000);
 svc.tick();
 assert.equal(shown.length,0);
});
