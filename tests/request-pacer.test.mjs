import {test} from 'node:test';import assert from 'node:assert/strict';import {RequestPacer} from '../lib/request-pacer.mjs';
test('同站串行，失败指数退避，成功恢复正常间隔',async()=>{
 let clock=0,active=0;const waits=[];const p=new RequestPacer({now:()=>clock,sleep:async ms=>{waits.push(ms);clock+=ms}});
 const fail=async()=>{assert.equal(active++,0);await Promise.resolve();active--;throw Error('网络失败')};
 await Promise.all([p.run('a',fail).catch(()=>{}),p.run('a',fail).catch(()=>{})]);await p.run('a',async()=>{});await p.run('a',async()=>{});assert.deepEqual(waits,[4000,8000,2000]);
});
test('等待中取消不会执行请求',async()=>{const c=new AbortController();c.abort();const p=new RequestPacer();await assert.rejects(p.run('a',()=>assert.fail(),c.signal));});
