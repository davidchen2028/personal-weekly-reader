import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {parseArticle,pagination,mergeBlocks} from '../parsers.mjs';
import {assess} from '../lib/article-fetcher.mjs';
import {normalizeCookies,Sessions} from '../lib/session.mjs';
import {Cache} from '../lib/cache.mjs';
const url='https://weekly.caixin.com/2026-08-21/102476335.html';
test('正文含多媒体块：顺序、嵌套配图与图注完整',()=>{const a=parseArticle(`<div id="the_content"><h1>测试</h1><div class="article_media_pic"><dl><dt><img data-src="//img.caixin.com/lead.jpg"></dt><dd>首图署名</dd></dl></div><div id="Main_Content_Val"><h2>第一章</h2><p>开头<img src="//img.caixin.com/inline.jpg" alt="插图">后半句</p><figure><img data-src="//img.caixin.com/body.jpg"><figcaption>DayOne 图片署名</figcaption></figure><dl><dt><img src="//img.caixin.com/ms.jpg"></dt><dd>微软图片署名</dd></dl><p>结尾■</p><div class="pip"><img src="//img.caixin.com/ad.jpg"></div></div></div>`,url);assert.deepEqual(a.blocks.map(b=>b.text||b.caption),['首图署名','第一章','开头','插图','后半句','DayOne 图片署名','微软图片署名','结尾■']);assert.equal(a.blocks.filter(b=>b.type==='image').length,4)});
test('分页只接受真实同篇链接；不能把推荐下一篇读进来',()=>{const nav=pagination(`<div id="pageNext"><a href="?all">余下全文</a><a href="?p1">01 第一章</a><a href="/2026-08-21/999.html">下一页</a></div>`,url);assert.equal(nav.all.url,url+'?all');assert.equal(nav.chapters[0].title,'第一章');assert.equal(nav.next,undefined)});
test('余下全文替换与续页边界合并不丢段落',()=>{const p=text=>({type:'paragraph',text});assert.deepEqual(mergeBlocks([p('a'),p('b')],[p('a'),p('b'),p('c')]),[p('a'),p('b'),p('c')]);assert.deepEqual(mergeBlocks([p('a'),p('b')],[p('b'),p('c'),p('b')]),[p('a'),p('b'),p('c'),p('b')])});
test('完整性保守判断：付费墙、缺章、下一页不能标全文',()=>{const a={blocks:[{type:'paragraph',text:'第一章 内容■'}]};assert.equal(assess(a,{locked:true}).access,'restricted');assert.equal(assess(a,{hasNext:true}).access,'partial');assert.equal(assess(a,{expanded:true,expected:[{title:'第二章'}]}).access,'partial');assert.equal(assess(a).access,'complete');assert.equal(assess({blocks:[{type:'paragraph',text:'很长但并无结束证据'}]}).access,'unverified')});
test('Cookie 导入保留 hostOnly、安全属性及有效期',()=>{const c=normalizeCookies([{name:'s',value:'test',domain:'.weekly.caixin.com',hostOnly:true,path:'/x',sameSite:'no_restriction',secure:true,httpOnly:true,expirationDate:Date.now()/1000+500}])[0];assert.equal(c.domain,'weekly.caixin.com');assert.equal(c.sameSite,'None');assert.equal(c.path,'/x');assert.equal(c.httpOnly,true);assert.throws(()=>normalizeCookies([{name:'s',value:'x',domain:'.caixin.com.evil.test'}]));assert.throws(()=>normalizeCookies([{name:'s',value:'x',domain:'.caixin.com',partitionKey:{topLevelSite:'https://caixin.com',hasCrossSiteAncestor:true}}]))});
test('一次性配对、持久化权限、会话版本和撤销',async()=>{const dir=await mkdtemp(tmpdir()+'/cx-session-test-');try{const s=await new Sessions(dir).init(),id='a'.repeat(32),code=s.pairCode().code;const p=await s.pair(id,code);assert(s.authorized(id,p.token));assert(!s.authorized('b'.repeat(32),p.token));await assert.rejects(s.pair(id,code));const ns=s.state.namespace;await s.sync([{name:'s',value:'test',domain:'.caixin.com'}]);assert.notEqual(ns,s.state.namespace);const ns2=s.state.namespace;await s.sync([{name:'s',value:'test',domain:'.caixin.com'}]);assert.equal(ns2,s.state.namespace);assert.equal((await stat(dir+'/session.json')).mode&0o777,0o600);await s.disconnect();assert(!s.authorized(id,p.token))}finally{await rm(dir,{recursive:true,force:true})}});
test('缓存隔离、完整内容保护和清除',async()=>{const dir=await mkdtemp(tmpdir()+'/cx-cache-test-');try{const c=await new Cache(dir).init();await c.put('alice',url,{url,access:'complete',fetchedAt:new Date().toISOString(),blocks:[{type:'paragraph',text:'正文'}]});assert.equal(await c.get('bob',url),null);assert((await c.get('alice',url)).cacheHit);await c.put('alice',url,{url,access:'preview',fetchedAt:new Date().toISOString(),blocks:[{type:'paragraph',text:'正文'}]});assert.equal((await c.get('alice',url)).access,'complete');await c.clear();assert.equal(await c.get('alice',url),null)}finally{await rm(dir,{recursive:true,force:true})}});

test('财新真实图片布局：font-size:0 的图像仍保留并关联 article_img_talk',()=>{const a=parseArticle('<div id="Main_Content_Val"><div class="article_img_container"><div class="article_img_box" style="font-size:0"><a><img src="https://img.caixin.com/test.jpg"></a></div><div class="article_img_talk">图片署名</div></div><p>尾段</p></div>',url);assert.deepEqual(a.blocks,[{type:'image',src:'https://img.caixin.com/test.jpg',caption:'图片署名'},{type:'paragraph',text:'尾段'}])});

test('首图透明加载动画不丢图，末尾网站图标不计入文章配图',()=>{
 const a=parseArticle('<div id="the_content"><div class="article_media_pic"><dl><dt><img src="https://img.caixin.com/lead.jpg" style="opacity: 0"></dt><dd>首图图注</dd></dl></div><div id="Main_Content_Val"><p>末段<span class="end_ico"><img src="https://www.caixin.com/favicon.ico"></span></p></div></div>','https://weekly.caixin.com/2026-08-21/102476335.html');
 assert.deepEqual(a.blocks,[{type:'image',src:'https://img.caixin.com/lead.jpg',caption:'首图图注'},{type:'paragraph',text:'末段'}]);
});
test('财新同篇结束图标保留核验信号，但不作为配图；锁定与分页仍优先',()=>{
 const url='https://weekly.caixin.com/2023-12-30/102151499.html';
 const html='<h1>测试</h1><div id="Main_Content_Val"><p>最后一段<a class="end_ico" href="'+url+'?_c=1"><img src="https://www.caixin.com/favicon.ico"></a></p></div>';
 const a=parseArticle(html,url);assert.equal(a.terminalMarker,true);assert.equal(a.blocks.length,1);
 assert.equal(assess(a).access,'complete');assert.equal(assess(a,{locked:true}).access,'restricted');assert.equal(assess(a,{hasNext:true}).access,'partial');
 assert.equal(parseArticle(html.replace(url+'?_c=1','https://weekly.caixin.com/2023-12-30/102151498.html'),url).terminalMarker,false);
 assert.equal(parseArticle(html.replace('class="end_ico"','class="end_ico" style="display:none"'),url).terminalMarker,false);
});
