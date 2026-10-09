import {chromium} from 'playwright';import fs from 'node:fs/promises';import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,channel:'chrome'});
try{
 const page=await browser.newPage({viewport:{width:850,height:1000}}),root=new URL('../app/src/main/assets/',import.meta.url);
 await page.route('https://reader.local/**',async r=>{const n=new URL(r.request().url()).pathname.slice(1);await r.fulfill({body:await fs.readFile(new URL(n,root)),contentType:n.endsWith('.js')?'application/javascript':n.endsWith('.css')?'text/css':'text/html'})});
 await page.addInitScript(()=>{window.reads=[];window.ReaderNative={restore:()=>'',save:()=>{},cancel:()=>{},load:(type,url,force,id)=>{let data={url};if(type==='shelf')data.issues=[{url:'https://weekly.caixin.com/2026/cw1/',year:2026,date:'2026-01-01',title:'测试'}];if(type==='issue')data.sections=[{title:'目录',articles:[{title:'文章A',url:'https://weekly.caixin.com/2026-01-01/1.html'},{title:'文章B',url:'https://weekly.caixin.com/2026-01-01/2.html'}]}];if(type==='article'){reads.push(url);data={url,title:url.includes('/1.html')?'文章A':'文章B',access:'complete',blocks:[{type:'paragraph',text:url}]}}setTimeout(()=>receiveNative(id,{state:'done',data}),10)}}});
 await page.goto('https://reader.local/index.html');await page.locator('.book').waitFor();assert.equal(await page.locator('#publication option').count(),3);
 await page.click('#cache-start');await page.getByText(/本轮完成/).waitFor({timeout:15000});assert.equal(await page.evaluate(()=>reads.length),2);
 await page.reload();await page.locator('.book').waitFor();await page.click('#cache-start');await page.getByText(/本轮完成/).waitFor();assert.equal(await page.evaluate(()=>reads.length),0);
 await page.click('.book');await page.getByRole('button',{name:/文章A/}).click();await page.locator('.paper h1').waitFor();assert.equal(await page.locator('.paper h1').innerText(),'文章A');await page.getByRole('button',{name:'‹ 返回目录'}).click();await page.getByRole('button',{name:/文章B/}).click();await page.locator('.paper h1').waitFor();assert.equal(await page.locator('.paper h1').innerText(),'文章B');
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 console.log('PASS: 三刊入口、成功进度重启保留、二次跳过、文章切换、大屏无横向溢出');
}finally{await browser.close()}
