import{test}from'node:test';import assert from'node:assert/strict';import{mkdtemp,rm}from'node:fs/promises';import{CbnProvider,cbnURL,cbnRef,parseCbnShelf,parseCbnArticle}from'../providers/cbnweek.mjs';import{Sessions}from'../lib/session.mjs';
test('第一财经类型ID区分、年份列表和域隔离',()=>{const items=parseCbnShelf([{data:[{id:1,type:'Magazine',summary:'杂志',cover_url:'https://imgcdn.cbnweek.com/a.jpg',maga_year:2026,maga_all_number:628},{id:1,type:'Subject',name:'单行本',cover_url:'https://imgcdn.cbnweek.com/b.jpg',publish_at:'2026-01-01'}]}]);assert.notEqual(items[0].id,items[1].id);assert.equal(cbnRef(items[1].url).type,'subject');assert.throws(()=>cbnURL('https://cbnweek.com.evil.test'));assert.throws(()=>cbnRef(items[0].url,'article'))});
test('全文必须获官网授权，保留全段落图片，短正文不伪装全文',()=>{const d={id:34768,title:'测试',is_jurisdiction:true,content:'<p>第一段</p><figure><img src="https://imgcdn.cbnweek.com/a.jpg"><figcaption>图注</figcaption></figure><h2>结语</h2><p>最后段落</p>'};const url='https://www.cbnweek.com/article_detail/34768';assert.equal(parseCbnArticle(d,url).access,'complete');assert.equal(parseCbnArticle({...d,is_jurisdiction:false},url).access,'restricted');assert.equal(parseCbnArticle({...d,word_times:8000},url).access,'unverified');assert.equal(parseCbnArticle(d,url).blocks[1].caption,'图注');assert.equal(parseCbnArticle({...d,content:d.content.replace('imgcdn.cbnweek.com','imgcdn.yicai.com')},url).access,'complete')});
test('令牌可独立形成第一财经会话，状态不泄露凭证，重配对保留会话',async()=>{const dir=await mkdtemp('/tmp/cbn-session-');const s=await new Sessions(dir,'cbnweek.com').init();try{await s.sync([],'secret-test-token');assert.equal(s.status().hasSession,true);assert.equal(s.status().hasToken,true);assert.ok(!JSON.stringify(s.status()).includes('secret-test-token'));const rev=s.state.revision;await s.pair('a'.repeat(32),s.pairCode().code);assert.equal(s.state.revision,rev);assert.equal(s.state.authorization,'secret-test-token');await s.sync([],'');assert.equal(s.status().hasSession,false)}finally{await s.resetBrowser();await rm(dir,{recursive:true,force:true})}});
test('独立题图加入正文首部，重复题图不再添加，非法题图不标为完整',()=>{
 const url='https://www.cbnweek.com/article_detail/34743',src='https://imgcdn.cbnweek.com/2026/09/hero.jpg';
 const d={id:34743,title:'题图文章',is_jurisdiction:true,cover_url:src,content:'<p>正文</p>'};
 const parsed=parseCbnArticle(d,url);
 assert.equal(parsed.parserVersion,2);assert.equal(parsed.blocks[0].src,src);assert.equal(parsed.blocks[0].role,'hero');
 assert.equal(parsed.blocks[1].text,'正文');
 assert.equal(parseCbnArticle({...d,content:'<img src="'+src+'"><p>正文</p>'},url).blocks.filter(b=>b.type==='image').length,1);
 assert.equal(parseCbnArticle({...d,cover_url:'https://evil.test/hero.jpg'},url).access,'unverified');
 assert.equal(parseCbnArticle({...d,cover_url:null},url).blocks[0].type,'paragraph');
});

test('杂志标称38篇实际37篇时仍展示全部五个栏目，并说明计数差异',async()=>{
 const p=new CbnProvider({state:{}},'/tmp/unused');const counts=[5,7,12,8,5];let id=1;const groups=counts.map((count,i)=>({column_name:'栏目'+i,articles:Array.from({length:count},()=>({id:id++,title:'文章'}))}));
 p.api=async path=>path.endsWith('/articles')?groups:{name:'第10期',articles_count:38,cover_url:'https://imgcdn.cbnweek.com/cover.jpg'};
 const d=await p.issue('https://www.cbnweek.com/magalog/650');assert.equal(d.sections.length,5);assert.equal(d.sections.flatMap(s=>s.articles).length,37);assert.match(d.meta,/官网目录 37 篇（期刊标称 38 篇）/);
 groups[0].articles=null;await assert.rejects(p.issue('https://www.cbnweek.com/magalog/650'),/栏目结构异常/);
});
test('空杂志目录与未取齐的单行本仍报错',async()=>{
 const p=new CbnProvider({state:{}},'/tmp/unused');p.api=async path=>path.endsWith('/articles')?[]:{articles_count:38};await assert.rejects(p.issue('https://www.cbnweek.com/magalog/650'),/目录为空/);
 p.api=async path=>path.includes('/articles?')?(path.endsWith('page=1')?[{id:1,title:'文章'}]:[]):{is_jurisdiction:true,articles_count:2};await assert.rejects(p.issue('https://www.cbnweek.com/read_detail/1'),/目录数量不一致/);
});
