import {test} from 'node:test';import assert from 'node:assert/strict';import {RequestPacer} from '../lib/request-pacer.mjs';
test('同站串行，失败指数退避，成功恢复正常间隔',async()=>{
 let clock=0,active=0;const waits=[];const p=new RequestPacer({now:()=>clock,sleep:async ms=>{waits.push(ms);clock+=ms}});
 const fail=async()=>{assert.equal(active++,0);await Promise.resolve();active--;throw Error('网络失败')};
 await Promise.all([p.run('a',fail).catch(()=>{}),p.run('a',fail).catch(()=>{})]);await p.run('a',async()=>{});await p.run('a',async()=>{});assert.deepEqual(waits,[4000,8000,2000]);
});
test('等待中取消不会执行请求',async()=>{const c=new AbortController();c.abort();const p=new RequestPacer();await assert.rejects(p.run('a',()=>assert.fail(),c.signal));});

test('财经保留10秒串行间隔，失败退避至5分钟，不影响默认刊物2秒间隔',async()=>{
 let clock=0;const waits=[];const p=new RequestPacer({gap:10000,maxDelay:300000,now:()=>clock,sleep:async ms=>{waits.push(ms);clock+=ms}});
 for(let n=0;n<6;n++)await p.run('caijing',async()=>{throw Error('暂时失败')}).catch(()=>{});
 await p.run('caijing',async()=>{});await p.run('caijing',async()=>{});
 assert.deepEqual(waits,[20000,40000,80000,160000,300000,300000,10000]);assert.equal(new RequestPacer().gap,2000);
});
