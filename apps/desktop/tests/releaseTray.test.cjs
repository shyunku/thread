const {test}=require("node:test"),assert=require("node:assert/strict");
const {ReleaseAlertService}=require("../public/electron/service/releaseAlert.service");

function service(latest){
 const sent=[],shown=[];
 const window={isDestroyed:()=>false,show:()=>shown.push("show"),focus:()=>shown.push("focus"),webContents:{send:(...args)=>sent.push(args)}};
 const s=new ReleaseAlertService();
 s.inject({windowService:{mainWindow:window},updaterService:{latestTrustedRelease:latest}});
 return {s,sent,shown};
}

test("tray check opens the notice when an update exists",async()=>{
 const {s,sent,shown}=service(async()=>({version:"9.9.9",mandatory:false}));
 assert.equal(await s.checkFromTray(),"available");
 assert.deepEqual(shown,["show","focus"]);
 const open=sent.find(([topic])=>topic==="release-alert/open");
 assert.equal(open[2].data.version,"9.9.9");
});

test("tray check reports up to date and failures separately",async()=>{
 assert.equal(await service(async()=>null).s.checkFromTray(),"latest");
 assert.equal(await service(async()=>{throw Error("offline");}).s.checkFromTray(),"failed");
});
