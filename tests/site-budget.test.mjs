import {test} from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm,writeFile} from 'node:fs/promises';import {SiteBudget} from '../lib/site-budget.mjs';
test('财经取消次数上限，升级移除旧计数但保留限流冷却和Retry-After',async()=>{
 const dir=await mkdtemp('/tmp/weekly-budget-');let now=1000000000;
 try{
 await writeFile(dir+'/request-budget.json',JSON.stringify({attempts:Array(200).fill(now),blockedUntil:now+60000,reason:'财经返回 429'}));
 let b=await new SiteBudget(dir,{now:()=>now}).init();assert.equal(b.state.attempts,undefined);await assert.rejects(b.before(),{code:'SITE_COOLDOWN'});
 now+=60001;for(let n=0;n<1000;n++)await b.before();
 await b.failed({status:429,retryAfter:'30000'});b=await new SiteBudget(dir,{now:()=>now}).init();assert.equal(b.state.blockedUntil,now+30000000);await assert.rejects(b.before(),{code:'SITE_COOLDOWN'});
 now+=30000001;await b.before();await b.failed({code:'EMPTY_CONTENT'});assert.equal(b.state.blockedUntil,now+21600000);
 }finally{await rm(dir,{recursive:true,force:true})}
});
