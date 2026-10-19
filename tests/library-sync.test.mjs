import {test} from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {LibrarySync,SYNC_INTERVAL} from '../lib/library-sync.mjs';import {Cache} from '../lib/cache.mjs';
async function fixture(fn){const dir=await mkdtemp(tmpdir()+'/cx-library-');try{await fn(dir)}finally{await rm(dir,{recursive:true,force:true})}}
const magazine=n=>({url:`https://weekly.caixin.com/2026/cw${n}/`,title:'刊'+n,cover:'https://img.caixin.com/cover.jpg'});
test('全部缓存遍历目录、去重、缓存全部配图，重启后增量获取新刊',()=>fixture(async dir=>{let list=[magazine(1),magazine(2)],details=0,downloads=0,images=0;const stored=new Map();const opts={dir,session:()=>({namespace:'account',revision:1,hasSession:true}),shelf:async()=>list,issue:async url=>{details++;return{sections:[{articles:[{url:url+'article'},{url:'shared'}]}]}},article:async url=>{if(stored.has(url))return{...stored.get(url),cacheHit:true};downloads++;const d={access:'complete',blocks:[{type:'image',src:'one'},{type:'image',src:'two'}]};stored.set(url,d);return d},image:async()=>images++};let job=await new LibrarySync(opts).init();job.start();await job.task;assert.equal(job.state.state,'done');assert.equal(downloads,3);assert.equal(job.state.articlesDone,3);assert.equal(images,8);assert.equal(details,2);assert.equal(job.state.nextCheck,null);await job.close();list=[magazine(3),...list];job=await new LibrarySync(opts).init();job.start();await job.task;assert.equal(details,3);assert.equal(downloads,4);assert.equal(job.state.skipped,3);await job.close()}));
test('未连接等待、重复点击单任务、暂停持久化且不再自动运行',()=>fixture(async dir=>{let hasSession=false,calls=0;let release;const job=await new LibrarySync({dir,session:()=>({namespace:'a',hasSession}),shelf:async()=>{calls++;await new Promise(r=>release=r);return[]},issue:async()=>{},article:async()=>{},image:async()=>{}}).init();job.start();assert.equal(job.state.state,'waiting');hasSession=true;job.start();job.start();assert.equal(calls,1);const stopping=job.pause();release();await stopping;assert.equal(job.state.enabled,false);job.tick();assert.equal(calls,1);await job.close();const again=await new LibrarySync({dir}).init();assert.equal(again.state.enabled,false);await again.close()}));
test('订阅受限时停止，不继续遍历余下文章',()=>fixture(async dir=>{let calls=0;const job=await new LibrarySync({dir,session:()=>({namespace:'a',hasSession:true}),shelf:async()=>[magazine(1)],issue:async()=>({sections:[{articles:[{url:'one'},{url:'two'}]}]}),article:async()=>{calls++;throw Object.assign(Error('登录失效'),{access:'restricted'})},image:async()=>{}}).init();job.start();await job.task;assert.equal(calls,1);assert.equal(job.state.state,'blocked');job.tick();assert.equal(calls,1);await job.close()}));
test('长期存档超过30天仍可读，临时缓存仍按原规则过期',()=>fixture(async dir=>{const a=await new Cache(dir+'/a',{permanent:true}).init(),b=await new Cache(dir+'/b').init();const data={access:'complete',fetchedAt:'2020-01-01',blocks:[{type:'paragraph',text:'测试正文'}]};await a.put('a','url',data);await b.put('a','url',data);assert.ok(await a.get('a','url'));assert.equal(await b.get('a','url'),null);assert.equal((await a.stats()).maxBytes,null)}));
test('会话改变中止旧任务，服务关闭后未完成任务可恢复',()=>fixture(async dir=>{let owner={namespace:'a',revision:1,hasSession:true},release;const opts={dir,session:()=>owner,shelf:async()=>{await new Promise(r=>release=r);return[]},issue:async()=>{},article:async()=>{},image:async()=>{}};const job=await new LibrarySync(opts).init();job.start();const closing=job.close();release();await closing;const restored=await new LibrarySync(opts).init();assert.equal(restored.state.state,'interrupted');restored.tick();assert.equal(restored.status().running,false);restored.start();owner={...owner,revision:2};release();await restored.task;assert.equal(restored.state.state,'error');assert.match(restored.state.message,/会话/);await restored.close()}));
test('完整 manifest 命中后不调用文章与图片下载',()=>fixture(async dir=>{let reads=0,pics=0;const job=await new LibrarySync({dir,session:()=>({namespace:'a',hasSession:true}),shelf:async()=>[{url:'issue',title:'测试'}],issue:async()=>({sections:[{articles:[{url:'article'}]}]}),completed:async()=>true,article:async()=>{reads++},image:async()=>{pics++}}).init();job.start();await job.task;assert.equal(reads,0);assert.equal(pics,0);assert.equal(job.state.skipped,1);assert.equal(job.state.articlesDone,1);await job.close()}));
test('目录 429 停止本刊并使用冷却时间',()=>fixture(async dir=>{let n=0;const job=await new LibrarySync({dir,session:()=>({namespace:'a',hasSession:true}),shelf:async()=>[magazine(1),magazine(2)],issue:async()=>{n++;if(n===1)throw Object.assign(Error('限流'),{status:429,retryAfter:'120'});return{sections:[]}},article:async()=>{},image:async()=>{}}).init();job.start();await job.task;assert.equal(n,1);assert.equal(job.state.state,'blocked');assert.equal(job.state.nextCheck,null);await job.close()}));
test('只下载最近20期，重启重跑跳过已有目录和完整文章',()=>fixture(async dir=>{
 let details=0,reads=0;const stored=new Set();
 const list=Array.from({length:105},(_,i)=>({url:'issue/'+i,date:new Date(Date.UTC(2020,0,1+i)).toISOString().slice(0,10)}));
 const opts={dir,session:()=>({namespace:'a',revision:1,hasSession:true}),shelf:async()=>list,
 issue:async url=>{details++;return{sections:[{articles:[{url:url+'/article'}]}]}},
 completed:async url=>stored.has(url),commit:async url=>{stored.add(url);return true},
 article:async()=>{reads++;return{access:'complete',blocks:[{type:'paragraph',text:'测试正文'}]}},image:async()=>{}};
 let job=await new LibrarySync(opts).init();job.start();await job.task;
 assert.equal(details,20);assert.equal(reads,20);assert.equal(job.status().issueCount,20);
 assert.ok(!stored.has('issue/0/article'));assert.ok(stored.has('issue/104/article'));await job.close();
 job=await new LibrarySync(opts).init();job.start();await job.task;
 assert.equal(details,20);assert.equal(reads,20);assert.equal(job.state.skipped,20);await job.close();
}));
test('旧定时状态和重启不会启动网络请求',()=>fixture(async dir=>{
 let calls=0;let job=await new LibrarySync({dir,session:()=>({hasSession:true}),shelf:async()=>{calls++;return[]}}).init();job.state.enabled=true;job.state.nextCheck=1;await job.save('status',job.state);await job.close();job=await new LibrarySync({dir,session:()=>({hasSession:true}),shelf:async()=>{calls++;return[]}}).init();job.startTimer();job.tick();assert.equal(calls,0);assert.equal(job.state.nextCheck,null);await job.close();
}));
for(const failure of [{code:'EMPTY_CONTENT'},{status:403},{status:429}])test('封面异常暂停该站 '+JSON.stringify(failure),()=>fixture(async dir=>{
 let reads=0;const job=await new LibrarySync({dir,session:()=>({hasSession:true}),shelf:async()=>[magazine(1)],issue:async()=>({sections:[{articles:[{url:'a'}]}]}),image:async()=>{throw Object.assign(Error('异常'),failure)},article:async()=>{reads++}}).init();job.start();await job.task;assert.equal(job.state.state,'blocked');assert.equal(reads,0);assert.equal(job.state.nextCheck,null);job.tick();assert.equal(job.task,null);await job.close();
}));
test('空正文不会落盘或覆盖已有正文',()=>fixture(async dir=>{
 const cache=await new Cache(dir,{permanent:true}).init();const data={access:'complete',blocks:[{type:'paragraph',text:'已缓存的正文'}]};await cache.put('a','old',data);
 for(const url of ['old','new'])await assert.rejects(cache.put('a',url,{access:'unverified',blocks:[]}),{code:'EMPTY_CONTENT'});
 assert.equal((await cache.get('a','old')).blocks[0].text,'已缓存的正文');assert.equal(await cache.get('a','new'),null);
}));
test('首页请求 403 也暂停且不自动恢复',()=>fixture(async dir=>{
 const job=await new LibrarySync({dir,session:()=>({hasSession:true}),shelf:async()=>{throw Object.assign(Error('网站返回 403'),{status:403})}}).init();job.start();await job.task;assert.equal(job.state.state,'blocked');assert.equal(job.state.nextCheck,null);await job.close();
}));
test('解析结果空正文时停止剩余文章',()=>fixture(async dir=>{
 let reads=0;const job=await new LibrarySync({dir,session:()=>({hasSession:true}),shelf:async()=>[{url:'issue'}],issue:async()=>({sections:[{articles:[{url:'a'},{url:'b'}]}]}),article:async()=>{reads++;return{access:'unverified',blocks:[]}},image:async()=>{}}).init();job.start();await job.task;assert.equal(reads,1);assert.equal(job.state.state,'blocked');await job.close();
}));
test('长期存档跨 Cookie 更新及服务重启复用，连续三次不重建正文配图',()=>fixture(async dir=>{
 let revision=1,reads=0,pics=0;let archive=await new Cache(dir+'/content',{permanent:true,reuseLocal:true}).init();
 const url='https://example.test/article',data={url,access:'complete',blocks:[{type:'paragraph',text:'已完整下载'},{type:'image',src:'https://example.test/image'}]};
 const {digest}=await import('../lib/cache.mjs');
 const create=()=>new LibrarySync({dir:dir+'/job',session:()=>({hasSession:true,namespace:'cookie-'+revision,revision}),shelf:async()=>[{url:'issue'}],issue:async()=>({sections:[{articles:[{url}]}]}),completed:(u,o)=>archive.completed(o.namespace,u),article:async(u,o)=>{reads++;return archive.put(o.namespace,u,data)},image:async(src,ref,o)=>{pics++;await archive.writeImage(archive.key(o.namespace,ref),digest(src),Buffer.from('image'),'image/png')},commit:(u,o)=>archive.commitComplete(o.namespace,u)});
 let originalKey;
 for(let run=1;run<=3;run++){revision=run;archive=await new Cache(dir+'/content',{permanent:true,reuseLocal:true}).init();const job=await create().init();job.start();await job.task;assert.equal(job.state.state,'done');assert.equal(reads,1);assert.equal(pics,1);const key=archive.key('cookie-'+revision,url);if(run===1)originalKey=key;else{assert.equal(key,originalKey);assert.equal(job.state.skipped,1)}await job.close()}
 assert.equal((await archive.inventory()).count,1);
 await archive.clear(originalKey);assert.equal(await archive.completed('cookie-3',url),false);
}));

test('登录快照独立持有后台浏览器，同步关闭前台不会关闭缓存浏览器',()=>fixture(async dir=>{
 const {Sessions}=await import('../lib/session.mjs');const live=await new Sessions(dir).init();await live.sync([{name:'test',value:'old',domain:'.caixin.com'}]);
 const worker=live.snapshot();let foregroundClosed=0,backgroundClosed=0;
 live.browser={close:async()=>foregroundClosed++};worker.browser={close:async()=>backgroundClosed++};
 await live.sync([{name:'test',value:'new',domain:'.caixin.com'}]);assert.equal(foregroundClosed,1);assert.equal(backgroundClosed,0);assert.equal(worker.state.cookies[0].value,'old');
 await worker.resetBrowser();assert.equal(backgroundClosed,1);
}));

test('整期缓存标记仅在所有正文配图完整时出现，清除后消失且不访问官网',()=>fixture(async dir=>{
 const cache=await new Cache(dir+'/content',{permanent:true,reuseLocal:true}).init();const job=await new LibrarySync({dir:dir+'/library',session:()=>({namespace:'a'}),completed:url=>cache.completed('a',url),shelf:()=>{throw Error('不可访问官网')}}).init();
 job.catalog.details={issue:{sections:[{articles:[{url:'one'},{url:'two'},{url:'one'}]}]},empty:{sections:[]}};
 await cache.put('a','one',{url:'one',access:'complete',blocks:[{type:'paragraph',text:'正文'}]});
 await cache.put('a','two',{url:'two',access:'complete',blocks:[{type:'image',src:'image'}]});
 assert.deepEqual(await job.cachedIssues(['issue','empty','unknown']),[]);
 const {digest}=await import('../lib/cache.mjs');await cache.writeImage(cache.key('a','two'),digest('image'),Buffer.from('test'),'image/png');
 assert.deepEqual(await job.cachedIssues(['issue','issue','empty']),['issue']);
 await cache.clear(cache.key('a','one'));assert.deepEqual(await job.cachedIssues(['issue']),[]);await job.close();
}));

test('持久化台账重启后不再检测或下载完成项，待确认项只在显式重试时读取',()=>fixture(async dir=>{
 let checks=0,reads=0,images=0,forceRetry=false;
 const opts={dir,session:()=>({namespace:'a',hasSession:true}),shelf:async()=>[{url:'issue',cover:'cover'}],issue:async()=>({sections:[{articles:[{url:'ok'},{url:'pending'}]}]}),completed:async()=>{checks++;return false},image:async()=>images++,commit:async()=>true,
 article:async(url,owner,signal,force)=>{reads++;if(url==='pending')forceRetry=!!force;return{access:url==='ok'||force?'complete':'unverified',blocks:[{type:'image',src:'pic'}]}}};
 let job=await new LibrarySync(opts).init();job.start();await job.task;assert.equal(reads,2);assert.equal(images,3);await job.close();
 job=await new LibrarySync(opts).init();job.start();await job.task;assert.equal(reads,2);assert.equal(images,3);assert.equal(checks,2);assert.equal(job.state.skipped,1);assert.equal(job.state.deferred,1);
 await job.retryFailed();job.start();await job.task;assert.equal(reads,3);assert.equal(forceRetry,true);assert.equal(job.state.state,'done');assert.equal(images,3);
 await job.forget('ok');job.start();await job.task;assert.equal(reads,4);assert.equal(images,4);await job.close();
}));

test('主体缓存达到80%显示可读标记，失败不冒充完整，预览不计入可读',()=>fixture(async dir=>{
 const job=await new LibrarySync({dir,session:()=>({}),completed:async()=>false,localArticle:async url=>({readable:url==='pending',missingImages:1})}).init();job.catalog.details.issue={sections:[{articles:['a','b','c','pending','missing'].map(url=>({url}))}]};for(const url of ['a','b','c'])job.records.articles[url]={state:'complete'};
 let [s]=await job.issueCoverage(['issue']);assert.equal(s.state,'mostly');assert.equal(s.readable,4);assert.equal(s.missing,1);assert.equal(s.pending,2);assert.equal(s.missingImages,1);
 delete job.records.articles.c;[s]=await job.issueCoverage(['issue']);assert.equal(s.state,'partial');for(const url of ['a','b','c','pending','missing'])job.records.articles[url]={state:'complete'};[s]=await job.issueCoverage(['issue']);assert.equal(s.state,'complete');assert.equal((await job.issueCoverage(['unknown']))[0].state,'none');await job.close();
}));
