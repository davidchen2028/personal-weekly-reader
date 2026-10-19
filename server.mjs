import {readFile,writeFile,rename} from 'node:fs/promises';
import {CbnProvider,cbnURL,cbnRef} from './providers/cbnweek.mjs';
import {CaijingProvider,caijingURL,caijingRef} from './providers/caijing.mjs';
import express from 'express';
import {EeoProvider,eeoURL,eeoRef} from './providers/eeo.mjs';
import {readSlots} from './lib/read-slots.mjs';
import {LibrarySync} from './lib/library-sync.mjs';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {parseShelf,parseIssue,safeURL,articleKey} from './parsers.mjs';
import {Sessions} from './lib/session.mjs';
import {ArticleFetcher} from './lib/article-fetcher.mjs';
import {Cache,digest} from './lib/cache.mjs';
import {request} from './lib/network.mjs';
async function createSingleApp({port=4317,autoSync=false,provider="caixin",bridgeSessions=null,dataDir=`${homedir()}/Library/Application Support/CaixinReader/v2`}={}){
 const domain={caixin:'caixin.com',eeo:'eeo.com.cn',caijing:'mycaijing.com',cbnweek:'cbnweek.com'}[provider],label={caixin:'财新',eeo:'经济观察报',caijing:'财经杂志',cbnweek:'第一财经'}[provider];
 const app=express(),origin=`http://127.0.0.1:${port}`,sessions=await new Sessions(dataDir,domain).init(),cache=await new Cache(dataDir+'/cache',{provider}).init(),fetcher=provider==='cbnweek'?await new CbnProvider(sessions,dataDir+'/discovery').init():provider==='caijing'?await new CaijingProvider(sessions,dataDir+'/discovery').init():provider==='eeo'?await new EeoProvider(sessions,dataDir+'/discovery').init():new ArticleFetcher(sessions);
 const validate=provider==='cbnweek'?cbnURL:provider==='caijing'?caijingURL:provider==='eeo'?eeoURL:safeURL,validateArticle=provider==='cbnweek'?u=>cbnRef(u,'article'):provider==='caijing'?u=>caijingRef(u,'article'):provider==='eeo'?u=>{if(!eeoRef(u).id)throw Error('缺少文章标识')}:articleKey;
 const remote=(ctx,url,options={})=>request(ctx,url,{...options,validator:validate});
 const fetchShelf=async signal=>{
  if(provider!=='caixin')return fetcher.shelf(signal);
  const response=await remote(null,'https://weekly.caixin.com/',{signal});
  const list=parseShelf(response.body.toString('utf8'));
  for(const item of list.filter(i=>i.featured&&!i.date)){
   const cached=shelfCache.find(i=>i.url===item.url&&i.date);
   if(cached){item.date=cached.date;item.year=cached.year;continue}
   try{
    const page=await remote(null,item.url,{signal});
    const detail=parseIssue(page.body.toString('utf8'),item.url);
    const date=detail.meta.match(/出版日期[：:]?\s*(\d{4})[-年](\d{2})[-月](\d{2})/);
    if(date){item.date=`${date[1]}年${date[2]}月${date[3]}日`;item.year=Number(date[1])}
   }catch(error){if(signal?.aborted)throw error}
  }
  return list;
 };

 let shelfCache=[];try{shelfCache=JSON.parse(await readFile(dataDir+'/shelf.json','utf8'))}catch{}
 let shelfRequest;
 const getShelf=signal=>{
  if(!shelfRequest)shelfRequest=(async()=>{
   const list=await fetchShelf(signal);if(!Array.isArray(list)||!list.length)throw Error('未获取到有效期刊目录');
   await writeFile(dataDir+'/shelf.json.tmp',JSON.stringify(list),{mode:0o600});
   await rename(dataDir+'/shelf.json.tmp',dataDir+'/shelf.json');shelfCache=list;return list;
  })().finally(()=>shelfRequest=null);
  return shelfRequest;
 };
 const getIssue=(url,signal,priority=0,force=false,source=fetcher)=>['caijing','cbnweek'].includes(provider)?readSlots.run(()=>source.issue(url,signal),signal,priority):provider==='eeo'?readSlots.run(()=>source.issue(url,signal,force),signal,priority).then(({articles,...d})=>({...d,cover:source.catalog.issues.find(i=>i.url===url)?.cover||''})):remote(null,url,{signal}).then(r=>parseIssue(r.body.toString('utf8'),url));
 const performRead=(url,signal,progress,force=false,priority=0)=>readSlots.run(()=>fetcher.read(url,signal,progress,force),signal,priority);
 const jobs=new Map(),active=new Map(),resources=new Map(),images=new Map();
 const currentParser=data=>provider==='cbnweek'?data?.parserVersion===2:provider==='caixin'&&data?.access==='unverified'?data.parserVersion===2:true;
 const archiveOwner=(source=sessions)=>{const state=source.state;const ids=(provider!=='caixin'?[]:state.cookies).filter(c=>['UID','SA_USER_UID'].includes(c.name)&&/^[1-9]\d*$/.test(c.value)).map(c=>c.name+':'+c.value).sort();return{...state,hasSession:!!(state.cookies.length||state.authorization)&&!state.disabled,namespace:ids.length?digest('library-account|'+ids.join('|')):state.namespace}};
 const archive=await new Cache(dataDir+'/library/content',{permanent:true,provider,reuseLocal:true}).init();
 async function archiveImage(src,referer,owner,signal,source=sessions){const generation=archive.generation,key=archive.key(owner.namespace,referer),id=digest(src);try{return await archive.readImage(key,id)}catch{}const ctx=owner.hasSession?await source.contextFor(owner.revision):null;const r=await remote(ctx,src,{referer,signal});const type=(r.headers['content-type']||'').split(';')[0];if(!['image/jpeg','image/png','image/gif','image/webp','image/avif'].includes(type))throw Error('图片类型不支持');signal?.throwIfAborted();if(owner.namespace!=='public'&&owner.namespace!==archiveOwner(source).namespace)throw Error('登录会话已变化');if(generation===archive.generation)await archive.writeImage(key,id,r.body,type);return{body:r.body,type}}
 // Each cache run owns an immutable credential snapshot and its own headless browser.
 // Extension cookie refreshes may close the foreground browser, never this worker.
 let workerSessions,workerFetcher;
 const library=await new LibrarySync({dir:dataDir+'/library',session:()=>archiveOwner(workerSessions||sessions),
 begin:async()=>{workerSessions=sessions.snapshot();workerFetcher=provider==='cbnweek'?await new CbnProvider(workerSessions,dataDir+'/discovery').init():provider==='caijing'?await new CaijingProvider(workerSessions,dataDir+'/discovery').init():provider==='eeo'?await new EeoProvider(workerSessions,dataDir+'/discovery').init():new ArticleFetcher(workerSessions)},
 end:async()=>{try{await workerSessions?.resetBrowser()}finally{workerSessions=null;workerFetcher=null}},
 shelf:signal=>shelfCache.length?Promise.resolve(shelfCache):provider==='caixin'?getShelf(signal):workerFetcher.shelf(signal),
 issue:(url,signal)=>getIssue(url,signal,1,false,workerFetcher),
 localArticle:async(url,owner)=>{const data=await archive.get(owner.namespace,url);if(!data||!['complete','unverified'].includes(data.access)||!data.blocks?.some(b=>typeof b.text==='string'&&b.text.trim()))return{readable:false};let missingImages=0;for(const b of data.blocks.filter(b=>b.type==='image'))try{await archive.readImage(archive.key(owner.namespace,url),digest(b.src))}catch{missingImages++}return{readable:true,missingImages}},
 completed:async(url,owner)=>await archive.completed(owner.namespace,url),
 commit:(url,owner)=>archive.commitComplete(owner.namespace,url),
 article:async(url,owner,signal,force=false)=>{const hit=await archive.get(owner.namespace,url);if(!force&&hit&&['complete','unverified'].includes(hit.access))return hit;let data=await cache.get(workerSessions.state.namespace,url);if(force||data?.access!=='complete'||!currentParser(data))data=await readSlots.run(()=>workerFetcher.read(url,signal,undefined,force),signal,1);signal.throwIfAborted();if(owner.namespace!==archiveOwner(workerSessions).namespace)throw Error('登录会话已变化');if(data.access==='restricted')throw Object.assign(Error(data.reason),{access:'restricted'});if(data.blocks?.length)await archive.put(owner.namespace,url,data);return data},
 image:async(src,ref,owner,signal)=>archiveImage(src,ref,(provider==='cbnweek'?cbnRef(ref).type!=='article':provider==='caijing'?caijingRef(ref).kind==='issue':provider==='eeo'?!eeoRef(ref).id:/\/cw\d+\//.test(ref))?{namespace:'public',hasSession:false}:owner,signal,workerSessions)
 }).init();
 const coverData=d=>{if(!d.cover)return d;const key=archive.key('public',d.url),id=digest(d.cover);resources.set(key+'/'+id,{ns:'public',src:d.cover,referer:d.url,key,id,archive:true});return{...d,cover:`/api/image/${key}/${id}?provider=${provider}`}};
 if(autoSync)library.startTimer();
 const extensionOrigin=o=>/^chrome-extension:\/\/[a-p]{32}$/.test(o||'');
 app.use((req,res,next)=>{
  if(req.headers.host!==`127.0.0.1:${port}`)return res.status(403).end();
  const from=req.headers.origin,bridge=req.path.startsWith('/api/bridge/');
  if(bridge){if(from&&!extensionOrigin(from))return res.status(403).end();if(extensionOrigin(from)){res.set('Access-Control-Allow-Origin',from);res.set('Vary','Origin');res.set('Access-Control-Allow-Methods','POST,OPTIONS');res.set('Access-Control-Allow-Headers','Content-Type,Authorization,X-Reader-Extension')};if(req.method==='OPTIONS')return res.sendStatus(204)}
  else if(from&&from!==origin)return res.status(403).end();
  if(req.method==='POST'&&!req.is('application/json'))return res.status(415).json({error:'需要 JSON 请求'});
  res.set('Cache-Control','no-store');res.set('X-Content-Type-Options','nosniff');res.set('Referrer-Policy','no-referrer');res.set('Content-Security-Policy',"default-src 'self'; img-src 'self' https://*.caixin.com https://*.eeo.com.cn https://www.mycaijing.com https://res.caijingmobile.com https://imgcdn.cbnweek.com data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'");next();
 });
 app.use(express.json({limit:'256kb'}));
 const resetJobs=(stopLibrary=true)=>{if(stopLibrary)library.changed();for(const j of jobs.values())if(j.state==='running')j.controller.abort();resources.clear();images.clear()};
 const eid=req=>{const id=req.headers['x-reader-extension']||req.headers.origin?.slice('chrome-extension://'.length);if(!/^[a-p]{32}$/.test(id||'')||(req.headers.origin&&req.headers.origin!==`chrome-extension://${id}`))throw Error('扩展来源无效');return id};
 const authorize=req=>{if(!(bridgeSessions||sessions).authorized(eid(req),(req.headers.authorization||'').replace(/^Bearer /,'')))throw Error('配对已失效，请重新配对')};
 app.post('/api/pair-code',(req,res)=>res.json((bridgeSessions||sessions).pairCode()));
 app.post('/api/bridge/pair',async(req,res)=>{const pairing=bridgeSessions||sessions;const data=await pairing.exclusive(()=>pairing.pair(eid(req),req.body.code));resetJobs(false);res.json(data)});
 app.post('/api/bridge/sync',async(req,res)=>{authorize(req);res.json(await sessions.exclusive(async()=>{authorize(req);const revision=sessions.state.revision;if(sessions.state.disabled&&!req.body.resume)throw Error('此刊物已断开，请在扩展中手动同步以恢复');const result=await sessions.sync(req.body.cookies,req.body.authorization);sessions.state.disabled=false;await sessions.save();if(revision!==sessions.state.revision)resetJobs(false);return result}))});
 app.post('/api/bridge/disconnect',async(req,res)=>{authorize(req);await sessions.exclusive(async()=>{const paired={extensionId:sessions.state.extensionId,token:sessions.state.token};await sessions.disconnect();if(req.body.scope==='provider'||req.path==='/api/disconnect')Object.assign(sessions.state,paired,{disabled:true});await sessions.save()});resetJobs();res.json({ok:true})});
 app.get('/api/status',async(req,res)=>res.json({...sessions.status(),provider,paired:!!(bridgeSessions||sessions).state.extensionId,cache:await cache.stats(),library:library.status(),archive:await archive.stats(),extensionPath:fileURLToPath(new URL('./extension',import.meta.url))}));
 app.post('/api/cookies',async(req,res)=>{let cookies=req.body.cookies;if(typeof cookies==='string')cookies=cookies.split(';').filter(x=>x.trim()).map(s=>{const i=s.indexOf('=');if(i<1)throw Error('Cookie 格式错误');return{name:s.slice(0,i).trim(),value:s.slice(i+1).trim(),domain:'.'+domain,secure:true,path:'/'}});res.json(await sessions.exclusive(()=>sessions.sync(cookies)));resetJobs(false)});
 app.post('/api/reconnect',async(req,res)=>{await sessions.exclusive(async()=>{sessions.state.disabled=false;await sessions.save()});res.json({ok:true})});
 app.post('/api/disconnect',async(req,res)=>{await sessions.exclusive(async()=>{const paired={extensionId:sessions.state.extensionId,token:sessions.state.token};await sessions.disconnect();if(req.body.scope==='provider'||req.path==='/api/disconnect')Object.assign(sessions.state,paired,{disabled:true});await sessions.save()});resetJobs();res.json({ok:true})});
 app.get('/api/issues',async(req,res)=>{let list;
 if(req.query.refresh!=='1'&&req.query.rescan!=='1'){
  const cached=shelfCache.length?shelfCache:fetcher.catalog?.issues?.length?fetcher.catalog.issues:library.catalog.issues;
  if(cached.length){res.set('X-Shelf-Cache','hit');return res.json(cached.map(coverData))}
 }
if(provider==='caijing'&&req.query.rescan==='1'&&!fetcher.discovery)fetcher.catalog.progress={};if(provider==='eeo'&&req.query.rescan==='1'&&!fetcher.discovery){fetcher.catalog.complete=false;fetcher.catalog.next='https://www.eeo.com.cn/epaper/eeocover/1.shtml'}try{list=await getShelf()}catch(e){if(req.query.refresh==='1'||!library.catalog.issues.length)throw e;list=library.catalog.issues}res.json(list.map(coverData))});
 app.get('/api/issue',async(req,res)=>{const url=validate(req.query.url);let detail=req.query.refresh==='1'?null:library.catalog.details[url];if(!detail)detail=await getIssue(url,undefined,0,req.query.refresh==='1');res.json(coverData(detail))});
 app.get('/api/library/status',async(req,res)=>{const s=library.status();if(provider!=='caixin')s.message=(s.message||'').replaceAll('财新',label);res.json(s)});
 app.post('/api/library/issues',async(req,res)=>{if(!Array.isArray(req.body.urls)||req.body.urls.length>100)throw Error('每次最多检查100期');const urls=req.body.urls.map(url=>validate(url));const issues=await library.issueCoverage(urls);res.json({cachedIssues:issues.filter(i=>i.state==='complete').map(i=>i.url),issues})});
 app.post('/api/library/retry',async(req,res)=>{if(library.task)throw Error('请先暂停当前缓存任务');await library.retryFailed();res.json(library.start())});
 app.post('/api/library/start',(req,res)=>res.json(library.start()));
 app.post('/api/library/pause',async(req,res)=>{await library.pause();res.json(library.status())});
 app.post('/api/library/clear',async(req,res)=>{await library.pause();await archive.clear();await library.forget();resources.clear();res.json({ok:true})});
 function decorate(data,ns,archived=false){const storageNs=archived?archiveOwner().namespace:ns,key=(archived?archive:cache).key(storageNs,data.url);return{...data,cacheKey:key,blocks:data.blocks.map(b=>{if(b.type!=='image')return b;const id=digest(b.src);resources.set(key+'/'+id,{ns,src:b.src,referer:data.url,key,id,archive:archived,archiveNs:storageNs});return{...b,originalSrc:b.src,src:`/api/image/${key}/${id}?provider=${provider}`}})}}
 app.post('/api/read',async(req,res)=>{
  const url=validate(req.body.url);validateArticle(url);if(req.body.refresh){await library.pause();await library.forget(url)}const ns=sessions.state.namespace,revision=sessions.state.revision;const existingArchive=await archive.get(archiveOwner().namespace,url);
  if(!req.body.refresh){const saved=await archive.get(archiveOwner().namespace,url);const hit=saved||await cache.get(ns,url);if(hit&&currentParser(hit)&&ns===sessions.state.namespace)return res.json({result:decorate(hit,ns,!!saved)})}
  const key=ns+'|'+url;let j=active.get(key);const subscriber=randomBytes(12).toString('hex');
  if(!j){j={id:randomBytes(16).toString('hex'),state:'running',stage:'准备读取',controller:new AbortController(),subscribers:new Set(),ns};jobs.set(j.id,j);active.set(key,j);const generation=cache.generation;
   performRead(url,j.controller.signal,s=>j.stage=s,!!req.body.refresh).then(async data=>{if(revision!==sessions.state.revision)throw Error('登录会话已更新，请重试');if(j.controller.signal.aborted)throw Error('读取已取消');if(generation===cache.generation)data=await cache.put(ns,url,data);if(revision!==sessions.state.revision)throw Error('登录会话已更新，请重试');if(existingArchive&&data.access==='complete')await archive.put(archiveOwner().namespace,url,data);j.result=decorate(data,ns);j.state='done'}).catch(e=>{j.error=e.message;j.state='error'}).finally(()=>{active.delete(key);setTimeout(()=>jobs.delete(j.id),300000).unref()});
  }
  j.subscribers.add(subscriber);res.json({jobId:j.id,subscriber});
 });
 app.get('/api/read/:id',(req,res)=>{const j=jobs.get(req.params.id);if(!j||j.ns!==sessions.state.namespace)return res.status(404).json({error:'读取任务已失效'});res.json({state:j.state,stage:j.stage,...(j.state==='done'?{result:j.result}:{}),error:j.error})});
 app.post('/api/read/:id/cancel',(req,res)=>{const j=jobs.get(req.params.id);if(j){j.subscribers.delete(req.body.subscriber);if(!j.subscribers.size&&j.state==='running')j.controller.abort()}res.json({ok:true})});
 app.post('/api/cache/clear',async(req,res)=>{if(req.body.url){const url=validate(req.body.url);await library.pause();await cache.clear(cache.key(sessions.state.namespace,url));await archive.clear(archive.key(archiveOwner().namespace,url));await library.forget(url)}else await cache.clear();res.json({ok:true,cache:await cache.stats()})});
 app.get('/api/image/:key/:id',async(req,res)=>{
  const key=req.params.key+'/'+req.params.id,asset=resources.get(key);if(!asset||(asset.ns!=='public'&&asset.ns!==sessions.state.namespace))return res.status(404).end();let result;
  try{result=await (asset.archive?archive:cache).readImage(asset.key,asset.id)}catch{
   if(asset.archive){result=await archiveImage(asset.src,asset.referer,{namespace:asset.archiveNs||asset.ns,revision:sessions.state.revision,hasSession:asset.ns!=='public'&&!!sessions.state.cookies.length});}else{
   if(!images.has(key)){const revision=sessions.state.revision,generation=cache.generation;
    const task=(async()=>{const ctx=sessions.state.cookies.length?await sessions.contextFor(revision):null;const r=await remote(ctx,asset.src,{referer:asset.referer});const type=(r.headers['content-type']||'').split(';')[0];if(!['image/jpeg','image/png','image/gif','image/webp','image/avif'].includes(type))throw Error('图片类型不支持');if(revision!==sessions.state.revision)throw Error('会话已变化');if(generation===cache.generation)await cache.writeImage(asset.key,asset.id,r.body,type);return{body:r.body,type}})().finally(()=>images.delete(key));images.set(key,task)}result=await images.get(key);}
  }
  if((asset.ns!=='public'&&asset.ns!==sessions.state.namespace))return res.status(404).end();res.type(result.type).send(result.body);
 });
 app.use(express.static(fileURLToPath(new URL('./public',import.meta.url))));
 app.use((err,req,res,next)=>{if(!res.headersSent)res.status(400).json({error:err.type==='entity.parse.failed'?'JSON 格式无效':err.message.includes('Executable')?'未找到 Google Chrome，请安装后重试':err.message})});
 return{app,sessions,cache,library,close:async()=>{await library.close();resetJobs();await sessions.resetBrowser()}};
}
export async function createApp({port=4317,autoSync=false,dataDir=`${homedir()}/Library/Application Support/CaixinReader/v2`}={}){
 const caixin=await createSingleApp({port,autoSync,dataDir});
 const eeo=await createSingleApp({port,autoSync,dataDir:dataDir+'/providers/eeo',provider:'eeo',bridgeSessions:caixin.sessions});
 const caijing=await createSingleApp({port,autoSync,dataDir:dataDir+'/providers/caijing',provider:'caijing',bridgeSessions:caixin.sessions});
 const cbnweek=await createSingleApp({port,autoSync,dataDir:dataDir+'/providers/cbnweek',provider:'cbnweek',bridgeSessions:caixin.sessions});
 const providers={caixin,eeo,caijing,cbnweek};
 const root=express();root.use(express.json({limit:'256kb'}));root.get('/api/providers',(req,res)=>{if(req.headers.host!==`127.0.0.1:${port}`)return res.sendStatus(403);res.json([{id:'caixin',name:'财新',title:'财新周刊'},{id:'eeo',name:'经济观察报',title:'经济观察报'},{id:'caijing',name:'财经杂志',title:'财经杂志'},{id:'cbnweek',name:'第一财经',title:'第一财经'}])});
 root.get('/api/sync-status',(req,res)=>{if(req.headers.host!==`127.0.0.1:${port}`||req.headers.origin&&req.headers.origin!==`http://127.0.0.1:${port}`)return res.sendStatus(403);res.set('Cache-Control','no-store');res.json(Object.entries(providers).map(([provider,p])=>({provider,...p.sessions.status(),paired:!!caixin.sessions.state.extensionId,disabled:!!p.sessions.state.disabled}))) });
 root.use((req,res,next)=>{const provider=req.query.provider||req.body?.provider||'caixin';if(!['caixin','eeo','caijing','cbnweek'].includes(provider)||req.query.provider&&req.body?.provider&&req.query.provider!==req.body.provider)return res.status(400).json({error:'刊物标识无效'});return providers[provider].app(req,res,next)});
 root.use((err,req,res,next)=>res.status(400).json({error:'请求格式无效'}));
 return{...caixin,app:root,providers,close:async()=>{await cbnweek.close();await caijing.close();await eeo.close();await caixin.close()}};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){const port=Number(process.env.PORT||4317),runtime=await createApp({port,autoSync:true});const server=runtime.app.listen(port,'127.0.0.1',()=>console.log(`财新阅读器 v2 http://127.0.0.1:${port}`));const stop=async()=>{server.close();await runtime.close();process.exit(0)};process.on('SIGINT',stop);process.on('SIGTERM',stop);}
