const {test}=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path"),Module=require("node:module");

// A fake electron: one 1920x1080 display, userData in a temp folder. No real windows.
const dir=fs.mkdtempSync(path.join(os.tmpdir(),"thread-window-mode-"));
const workArea={x:0,y:0,width:1920,height:1040};
const electron={app:{getPath:()=>dir},BrowserWindow:class{},screen:{getDisplayMatching:()=>({workArea}),getAllDisplays:()=>[{workArea}],getPrimaryDisplay:()=>({workArea})}};
const load=Module._load;
Module._load=function(request,...rest){return request==="electron"?electron:load.call(this,request,...rest);};
const WindowService=require("../public/electron/service/window.service");
const {saveWindowState}=require("../public/electron/modules/windowState");
Module._load=load;
test.after(()=>fs.rmSync(dir,{recursive:true,force:true}));

// Records what the window was asked to do, in order.
function fakeWindow(){
 const log=[],once={};
 let bounds={x:770,y:270,width:380,height:500},visible=true,opacity=1,maximized=false;
 const w={log,isDestroyed:()=>false,isVisible:()=>visible,isMaximized:()=>maximized,isFullScreen:()=>false,isResizable:()=>false,
  getBounds:()=>bounds,getNormalBounds:()=>bounds,getMinimumSize:()=>[340,440],getOpacity:()=>opacity,
  setOpacity:v=>{opacity=v;log.push(["opacity",v]);},
  hide:()=>{visible=false;log.push(["hide",opacity]);},
  show:()=>{visible=true;log.push(["show"]);(once.show||[]).splice(0).forEach(f=>f());},
  focus:()=>{},maximize:()=>{maximized=true;log.push(["maximize"]);},unmaximize:()=>{maximized=false;},
  setBounds:b=>{bounds={...bounds,...b};log.push(["bounds",visible,opacity]);},
  setMinimumSize:()=>{},setResizable:()=>{},on:()=>{},
  once:(event,f)=>{(once[event]=once[event]||[]).push(f);}};
 return w;
}

test("leaving the unlock window: it turns transparent and hides before it moves, and shows opaque when ready",()=>{
 saveWindowState(electron.app,{x:100,y:80,width:1300,height:850,maximized:false});
 const service=new WindowService();
 const w=fakeWindow();
 service.mainWindow=w;
 // The unlock screen first (centered), then the workspace.
 assert.ok(service.setVaultMode("lock"));
 w.log.length=0;
 assert.ok(service.setVaultMode("app"));
 const firstMove=w.log.findIndex(([k])=>k==="bounds");
 assert.deepEqual(w.log.slice(0,2),[["opacity",0],["hide",0]]);
 assert.ok(firstMove>1);
 // Every move happens hidden and transparent.
 for(const [k,visible,opacity] of w.log)if(k==="bounds")assert.deepEqual([visible,opacity],[false,0]);
 assert.deepEqual(w.getBounds(),{x:100,y:80,width:1300,height:850});
 // The workspace says it has loaded.
 assert.ok(service.revealMainWindow());
 assert.equal(w.isVisible(),true);
 assert.equal(w.getOpacity(),1);
 clearTimeout(service.pendingReveal?.timer);
});

test("the unlock window is centered on the display, not moved to the remembered workspace place",()=>{
 saveWindowState(electron.app,{x:2000,y:80,width:1300,height:850,maximized:false});
 const service=new WindowService();
 const w=fakeWindow();
 service.mainWindow=w;
 service.setVaultMode("lock");
 assert.deepEqual(w.getBounds(),{x:770,y:270,width:380,height:500});
});

// At start (#107): hidden until the first screen is known, so the big window never flashes
// before the lock screen.
function startingWindow(){
 const w=fakeWindow(),ready=[];
 let visible=false;
 w.isVisible=()=>visible;
 const show=w.show;w.show=()=>{visible=true;show();};
 const hide=w.hide;w.hide=()=>{visible=false;hide();};
 const once=w.once;w.once=(event,f)=>{if(event==="ready-to-show")ready.push(f);else once(event,f);};
 w.ready=()=>ready.splice(0).forEach(f=>f());
 return w;
}

test("at start the main window shows only once the lock screen has sized it",()=>{
 const service=new WindowService();
 const w=startingWindow();
 service.mainWindow=w;
 service.awaitFirstScreen(w);
 w.ready();
 assert.equal(w.isVisible(),false);
 assert.ok(service.setVaultMode("lock"));
 assert.equal(w.isVisible(),true);
 assert.deepEqual(w.getBounds(),{x:770,y:270,width:380,height:500});
 // Shown once: the size came before the show.
 const order=w.log.map(([k])=>k).filter(k=>k==="bounds"||k==="show");
 assert.deepEqual(order.slice(-2),["bounds","show"]);
 assert.equal(service.firstScreen,null);
});

test("straight into the workspace at start: hidden until it has loaded",()=>{
 saveWindowState(electron.app,{x:100,y:80,width:1300,height:850,maximized:false});
 const service=new WindowService();
 const w=startingWindow();
 service.mainWindow=w;
 service.awaitFirstScreen(w);
 w.ready();
 assert.ok(service.setVaultMode("app"));
 assert.equal(w.isVisible(),false);
 assert.deepEqual(w.getBounds(),{x:100,y:80,width:1300,height:850});
 assert.ok(service.revealMainWindow());
 assert.equal(w.isVisible(),true);
});

test("a first screen that never says what it is still shows after a while",(t)=>{
 t.mock.timers.enable({apis:["setTimeout"]});
 const service=new WindowService();
 const w=startingWindow();
 service.mainWindow=w;
 service.awaitFirstScreen(w);
 w.ready();
 t.mock.timers.tick(2999);
 assert.equal(w.isVisible(),false);
 t.mock.timers.tick(1);
 assert.equal(w.isVisible(),true);
 // The login screen shows it at once.
 const login=new WindowService(),lw=startingWindow();
 login.mainWindow=lw;
 login.awaitFirstScreen(lw);
 lw.ready();
 assert.ok(login.showFirstScreen());
 assert.equal(lw.isVisible(),true);
 assert.equal(login.showFirstScreen(),false);
});
