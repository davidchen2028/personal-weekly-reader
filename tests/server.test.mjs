import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {createServer} from 'node:net';
import {createApp} from '../server.mjs';
test('本地 API：来源限制、一次性配对、鉴权同步和撤销',async()=>{
 const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
 const dir=await mkdtemp(tmpdir()+'/cx-api-test-'),runtime=await createApp({port,dataDir:dir});const server=runtime.app.listen(port,'127.0.0.1');const base=`http://127.0.0.1:${port}`,ext='a'.repeat(32),origin='chrome-extension://'+ext;
 const post=(path,body,headers={})=>fetch(base+'/api/'+path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
 try{
  assert.equal((await post('pair-code',{}, {Origin:'https://evil.test'})).status,403);
  assert.equal((await post('bridge/sync',{cookies:[]},{Origin:origin,'X-Reader-Extension':ext})).status,400);
  const {code}=await(await post('pair-code',{})).json();
  const pair=await post('bridge/pair',{code},{Origin:origin,'X-Reader-Extension':ext});assert.equal(pair.status,200);const {token}=await pair.json();
  const headers={Origin:origin,'X-Reader-Extension':ext,Authorization:'Bearer '+token};
  assert.equal((await post('bridge/pair',{code},{Origin:origin,'X-Reader-Extension':ext})).status,400);
  assert.equal((await post('bridge/sync',{cookies:[{name:'session',value:'test-only',domain:'.caixin.com'}]},headers)).status,200);
  const status=await(await fetch(base+'/api/status')).json();assert.equal(status.hasSession,true);assert.equal(status.paired,true);assert.equal(JSON.stringify(status).includes('test-only'),false);
  assert.equal((await post('bridge/sync',{cookies:[]},{...headers,Origin:'chrome-extension://'+'b'.repeat(32)})).status,400);
  assert.equal((await post('bridge/disconnect',{},headers)).status,200);
  assert.equal((await post('bridge/sync',{cookies:[]},headers)).status,400);
  assert.equal((await fetch(base+'/api/image/'+'a'.repeat(64)+'/'+'b'.repeat(64))).status,404);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));await runtime.close();await rm(dir,{recursive:true,force:true})}
});
test('双刊共用配对，Cookie/暂停/断开/域名互相隔离',async()=>{
 const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));const dir=await mkdtemp(tmpdir()+'/cx-dual-api-'),runtime=await createApp({port,dataDir:dir});const server=runtime.app.listen(port,'127.0.0.1');const base=`http://127.0.0.1:${port}`,ext='c'.repeat(32);const post=(path,body,h={})=>fetch(base+'/api/'+path,{method:'POST',headers:{'Content-Type':'application/json',...h},body:JSON.stringify(body)});
 try{const {code}=await(await post('pair-code',{})).json();const {token}=await(await post('bridge/pair',{code},{'X-Reader-Extension':ext})).json();const h={'X-Reader-Extension':ext,Authorization:'Bearer '+token};
 assert.equal((await post('bridge/sync',{provider:'eeo',cookies:[{name:'test',value:'x',domain:'.eeo.com.cn'}]},h)).status,200);
 assert.equal(runtime.sessions.state.cookies.length,0);assert.equal(runtime.providers.eeo.sessions.state.cookies.length,1);
 assert.equal((await post('bridge/sync',{provider:'eeo',cookies:[{name:'',value:'test-only',domain:'.eeo.com.cn'}]},h)).status,200);
 assert.equal(runtime.providers.eeo.sessions.state.cookies[0].name,'');
 assert.equal((await post('bridge/sync',{provider:'eeo',cookies:[{name:'test',value:'x',domain:'.caixin.com'}]},h)).status,400);
 assert.equal((await post('bridge/disconnect',{provider:'caixin',scope:'provider'},h)).status,200);
 assert.equal((await post('bridge/sync',{provider:'eeo',cookies:[{name:'test',value:'x',domain:'.eeo.com.cn'}]},h)).status,200);
 assert.equal((await post('bridge/sync',{provider:'caijing',cookies:[{name:'',value:'test-only',domain:'.mycaijing.com'}]},h)).status,200);
 assert.equal(runtime.providers.caijing.sessions.state.cookies.length,1);
 assert.equal((await post('bridge/sync',{provider:'caijing',cookies:[{name:'x',value:'test-only',domain:'.eeo.com.cn'}]},h)).status,400);
 assert.equal((await post('bridge/disconnect',{provider:'caijing',scope:'provider'},h)).status,200);
 assert.equal(runtime.providers.caijing.sessions.state.cookies.length,0);
 assert.equal(runtime.providers.eeo.sessions.state.cookies.length,1);
 assert.equal((await post('bridge/sync',{provider:'cbnweek',cookies:[],authorization:'test-auth'},h)).status,200);
 assert.equal(runtime.providers.cbnweek.sessions.status().hasToken,true);
 await post('disconnect',{provider:'cbnweek'});assert.equal(runtime.providers.cbnweek.sessions.state.disabled,true);
 assert.equal((await post('bridge/sync',{provider:'cbnweek',cookies:[],authorization:'test-auth'},h)).status,400);
 assert.equal((await post('reconnect',{provider:'cbnweek'})).status,200);
 assert.equal((await post('bridge/sync',{provider:'cbnweek',cookies:[],authorization:'test-auth'},h)).status,200);
 assert.equal(runtime.providers.eeo.sessions.state.cookies.length,1);
 const overview=await(await fetch(base+'/api/sync-status')).json();assert.equal(overview.length,4);assert.ok(!JSON.stringify(overview).includes('test-auth'));
 assert.equal((await post('bridge/sync',{provider:'eeo',cookies:[],authorization:'test-auth'},h)).status,400);
 await post('library/pause',{provider:'eeo'});assert.equal(runtime.providers.eeo.library.state.enabled,false);assert.equal(runtime.library.state.enabled,false);
 assert.equal((await post('read',{provider:'eeo',url:'https://weekly.caixin.com/2026-09-04/102481858.html'})).status,400);
 assert.equal((await post('library/clear',{provider:'wrong'})).status,400);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));await runtime.close();await rm(dir,{recursive:true,force:true})}
});
