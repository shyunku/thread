const {test}=require("node:test"),assert=require("node:assert/strict");
const {getServerFinalEndpoint,getWebsocketFinalEndpoint}=require("../public/electron/modules/util");

test("local Docker endpoint uses IPv4 for main-process HTTP and WebSocket",t=>{
 const previous=process.env.REACT_APP_APP_SERVER_ENDPOINT;
 t.after(()=>{if(previous===undefined)delete process.env.REACT_APP_APP_SERVER_ENDPOINT;else process.env.REACT_APP_APP_SERVER_ENDPOINT=previous;});
 process.env.REACT_APP_APP_SERVER_ENDPOINT="http://localhost:4033";
 assert.equal(getServerFinalEndpoint(),"http://127.0.0.1:4033/v1");
 assert.equal(getWebsocketFinalEndpoint(),"ws://127.0.0.1:4033/v1/websocket/connect");
 process.env.REACT_APP_APP_SERVER_ENDPOINT="https://api.threadapp.kr";
 assert.equal(getServerFinalEndpoint(),"https://api.threadapp.kr/v1");
 process.env.REACT_APP_APP_SERVER_ENDPOINT="https://localhost:4033";
 assert.equal(getServerFinalEndpoint(),"https://localhost:4033/v1");
});
