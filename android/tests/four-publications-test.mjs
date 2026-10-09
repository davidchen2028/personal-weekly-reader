import {chromium} from 'playwright';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const b=await chromium.launch({channel:'chrome',headless:true});
try{
 const p=await b.newPage();await p.goto('about:blank');
 await p.addScriptTag({content:await readFile(new URL('../app/src/main/assets/providers.js',import.meta.url),'utf8')});
 const results=await p.evaluate(()=>{
  const cbn=parsePublication('cbnweek','article','https://www.cbnweek.com/article_detail/1',{id:1,title:'题图',cover_url:'https://imgcdn.cbnweek.com/a.jpg',content:'<p>正文</p>',is_jurisdiction:true});
  const eeo=parsePublication('eeo','issue','https://epaper.eeo.com.cn/epaper/index.html?qid=1',{state:true,usertype:2,data:{list:[{version_number:1,article_type:'新闻',article_list:[{id:1,title:'第一篇',content:'<p>完整正文</p>'}]},{version_number:2,article_type:'市场',article_list:[{id:1,title:'跨版同号',content:'<p>第二篇</p>'}]}]}});
  const caijing=parsePublication('caijing','article','https://www.mycaijing.com/article/detail/1?source_id=1','<h1 class="article-title">文章</h1><div class="article-content"><p>正文</p><img src="https://res.caijingmobile.com/a.jpg"></div>');
  return{cbn,eeo,caijing};
 });
 assert.equal(results.cbn.blocks[0].type,'image');assert.equal(results.cbn.access,'complete');
 assert.equal(results.eeo.sections.length,2);assert.equal(Object.keys(results.eeo.articles).length,2);
 assert.equal(results.caijing.blocks.length,2);assert.equal(results.caijing.access,'complete');
 console.log('PASS: cbn hero and authority, eeo all sections and conflicting IDs, caijing text/images');
}finally{await b.close()}
