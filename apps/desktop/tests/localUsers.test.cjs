const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const sqlite3=require("sqlite3");
const {saveGoogleUser}=require("../public/electron/modules/localUsers");

// The shipped template is the schema every new installation starts from.
function templateCopy(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"thread-local-users-"));
 const file=path.join(dir,"root.sqlite3");
 fs.copyFileSync(path.join(__dirname,"../public/resources/root.sqlite3"),file);
 const db=new sqlite3.Database(file);
 t.after(()=>new Promise(resolve=>db.close(()=>{fs.rmSync(dir,{recursive:true,force:true});resolve();})));
 const call=method=>(sql,params=[])=>new Promise((resolve,reject)=>db[method](sql,params,(error,rows)=>error?reject(error):resolve(rows)));
 return {all:call("all"),run:call("run")};
}

test("first Google sign-in on a new device creates the local account row",async t=>{
 const db=templateCopy(t);
 const user={uid:"fixture-uid",auth_id:"fixture",username:"Fixture",google_auth_id:"g-1",google_email:"fixture@example.invalid",google_profile_image_url:null};
 await saveGoogleUser(db,user);
 let [row]=await db.all("SELECT * FROM users WHERE uid = ?",["fixture-uid"]);
 assert.equal(row.google_auth_id,"g-1");
 assert.equal(row.auth_hashed_pw,"");
 await saveGoogleUser(db,{...user,username:"Renamed"});
 [row]=await db.all("SELECT * FROM users WHERE uid = ?",["fixture-uid"]);
 assert.equal(row.username,"Renamed");
 assert.equal((await db.all("SELECT * FROM users")).length,1);
 // An empty hash never matches a real password hash.
 assert.equal((await db.all("SELECT * FROM users WHERE auth_hashed_pw = ?",["e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"])).length,0);
});
