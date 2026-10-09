import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const b=await chromium.launch({channel:'chrome',headless:true});
try{
 for(const provider of ['caixin','eeo','caijing','cbnweek']){
 const p=await b.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
 const old={id:'1',url:'https://www.mycaijing.com/issue/detail/1',title:'已有期刊',date:'2026-09-01',year:2026,issueType:0,cover:''};
 const fresh={...old,id:'2',url:'https://www.mycaijing.com/issue/detail/2',title:'新发布期刊',date:'2026-09-28'};
 let release,refreshCount=0;
 await p.route('**/api/issues?*',async r=>{
  if(new URL(r.request().url()).searchParams.has('refresh')){
   refreshCount++;await new Promise(resolve=>release=resolve);
   return r.fulfill({json:[fresh,old]});
  }
  return r.fulfill({json:[old]});
 });
 await p.goto('http://127.0.0.1:4317/?provider='+provider);
 await p.locator('.book').waitFor();assert.equal(await p.locator('.book').count(),1);
 await p.waitForFunction(()=>document.querySelector('#shelf-sync').textContent.includes('后台'));
 if(await p.locator('#issue-type').count())await p.selectOption('#issue-type','0');
 await p.click('#refresh');assert.equal(refreshCount,1,'background requests deduplicated');
 release();await p.waitForFunction(()=>document.querySelectorAll('.book').length===2);
 if(await p.locator('#issue-type').count())assert.equal(await p.locator('#issue-type').inputValue(),'0');
 assert.match(await p.locator('#shelf-sync').innerText(),/已更新/);
 await p.unroute('**/api/issues?*');
 await p.route('**/api/issues?*',r=>r.fulfill({status:503,json:{error:'offline'}}));
 await p.click('#refresh');await p.waitForFunction(()=>document.querySelector('#shelf-sync').textContent.includes('更新失败'));
 assert.equal(await p.locator('.book').count(),2);assert.deepEqual(errors,[]);
 await p.close();}
 console.log('PASS: four publications; cached shelf displays before background response; new issue updates; filter retained; deduplication; failure retains shelf');
}finally{await b.close()}
