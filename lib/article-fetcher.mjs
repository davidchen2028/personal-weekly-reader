import {parseArticle,pagination,mergeBlocks,sameArticle,articleKey} from '../parsers.mjs';
import {request,checkedURL} from './network.mjs';
import {load} from 'cheerio';
const charCount=a=>a.blocks.reduce((n,b)=>n+(b.text?.length||0),0);
const textOf=a=>a.blocks.filter(b=>b.type!=='image').map(b=>b.text).join('\n');
export function assess(a,{locked=false,expanded=false,hasNext=false,expected=[],readPages=1}={}){
 const text=textOf(a),covered=expected.filter(c=>text.includes(c.title)),end=a.terminalMarker===true||/[■□◆]\s*$/.test(text);
 if(locked)return{access:'restricted',reason:'财新仍显示登录或订阅提示',covered:covered.length,expected:expected.length};
 if(!charCount(a))return{access:'partial',reason:'未识别到正文',covered:0,expected:expected.length};
 if(hasNext)return{access:'partial',reason:'仍有未读取的分页',covered:covered.length,expected:expected.length};
 if(expected.length&&covered.length<expected.length)return{access:'partial',reason:'部分章节尚未核对完整',covered:covered.length,expected:expected.length};
 const complete=(expected.length>0&&(expanded||readPages>1)&&covered.length===expected.length)||end;
 return{access:complete?'complete':'unverified',reason:complete?'已核对全文结束或全部章节':'已读取可见正文，原文缺少可核验的完整结束信号',covered:covered.length,expected:expected.length};
}
async function snapshot(page){return page.evaluate(()=>{
 const hidden=e=>{for(let n=e;n&&n!==document.body;n=n.parentElement){const s=getComputedStyle(n);if(s.display==='none'||s.visibility==='hidden'||((s.opacity==='0'||s.fontSize==='0px')&&e.tagName!=='IMG'&&!e.querySelector('img')))return true}return false};
 const wall=document.querySelector('#chargeWall');const locked=!!wall&&!hidden(wall)&&wall.getBoundingClientRect().height>20&&wall.innerText.trim().length>0;
 const clone=document.documentElement.cloneNode(true);const original=[...document.querySelectorAll('#Main_Content_Val *, .article_media_pic *')],copied=[...clone.querySelectorAll('#Main_Content_Val *, .article_media_pic *')];
 original.forEach((e,i)=>{if(hidden(e))copied[i]?.remove();else if(e.tagName==='IMG'&&e.currentSrc)copied[i]?.setAttribute('data-reader-src',e.currentSrc)});
 return{html:clone.outerHTML,locked};
})}
async function settle(page){
 // Wait for the paid-content loader or a visible subscription response, rather than networkidle (ads may never idle).
 await page.locator('#Main_Content_Val').waitFor({timeout:12000});
 await page.waitForFunction(()=>{
  const r=document.querySelector('#Main_Content_Val'),w=document.querySelector('#chargeWall');
  return !!r&&(r.innerText.includes('■')||!!r.querySelector('a.end_ico')||!!document.querySelector('#pageBtn a')||(w&&w.getBoundingClientRect().height>20&&w.innerText.trim().length>0));
 },{},{timeout:6500}).catch(()=>{});
 await page.waitForFunction(()=>{const w=document.querySelector('#chargeWall');return !w||getComputedStyle(w).display==='none'||w.innerText.trim().length===0},{},{timeout:6000}).catch(()=>{});

}
async function lazyMedia(page){
 const images=page.locator('#Main_Content_Val img:not([src]):not([data-src]):not([data-original]), #the_content .article_media_pic img:not([src]):not([data-src]):not([data-original])');const n=Math.min(await images.count(),200);
 for(let i=0;i<n;i++){await images.nth(i).scrollIntoViewIfNeeded({timeout:800}).catch(()=>{});}
 await page.waitForFunction(()=>[...document.querySelectorAll('#Main_Content_Val img, .article_media_pic img')].every(e=>e.currentSrc||e.getAttribute('data-src')||e.getAttribute('data-original')),{},{timeout:1200}).catch(()=>{});
}
export class ArticleFetcher{
 constructor(sessions){this.sessions=sessions;this.active=0;this.waiting=[];this.jobs=new Map();this.fullRoutes=new Map()}
 async slot(signal){if(this.active>=2)await new Promise((resolve,reject)=>{const item={resolve,reject};this.waiting.push(item);const cancel=()=>{this.waiting=this.waiting.filter(x=>x!==item);reject(Error('读取已取消'))};signal.addEventListener('abort',cancel,{once:true});item.resolve=()=>{signal.removeEventListener('abort',cancel);resolve()}});signal.throwIfAborted();this.active++}
 release(){this.active--;this.waiting.shift()?.resolve()}
 async read(url,signal,progress=()=>{}){
  articleKey(url);const started=Date.now(),timings={};let checkpoint=started;const mark=name=>{const now=Date.now();timings[name]=(timings[name]||0)+now-checkpoint;checkpoint=now};await this.slot(signal);mark('queue');let page;const revision=this.sessions.state.revision;const timeout=AbortSignal.timeout(45000);const combined=AbortSignal.any([signal,timeout]);
  try{
   progress('正在读取正文');
   const hasSession=this.sessions.state.cookies.length>0;const routeKey=this.sessions.state.namespace+'|'+url;const hint=this.fullRoutes.get(routeKey);
   const ctx=hasSession?await this.sessions.contextFor(revision):null;
   mark('browserContext');let initial;try{if(!hint){const r=await request(ctx,url,{signal:combined});initial=r.body.toString('utf8')}}catch(e){if(!hasSession||e.code==='EMPTY_CONTENT'||[403,429].includes(e.status))throw e}
   mark('initialHttp');let base=initial?parseArticle(initial,url):null;
   if(!hasSession)return{...base,access:'preview',reason:'请连接日常 Chrome 的财新会话',path:'http',fetchedAt:new Date().toISOString(),timings,elapsedMs:Date.now()-started,expectedChapters:base.chapters?.length||0};
   const staticNav=initial?pagination(initial,url):{chapters:[]};
   // HTTP is accepted only if the page has a terminal marker and contains no paid loader / remaining pagination.
   if(initial){const $=load(initial),proof=assess(base,{hasNext:!!staticNav.next||!!staticNav.all,expected:staticNav.chapters});if(!$('#chargeWall').length&&proof.access==='complete')return{...base,...proof,path:'http',fetchedAt:new Date().toISOString(),timings,elapsedMs:Date.now()-started};}
   mark('httpParse');combined.throwIfAborted();progress('正在后台加载财新正文');page=await ctx.newPage();
   const stop=()=>page?.close().catch(()=>{});combined.addEventListener('abort',stop,{once:true});
   await page.route('**/*',async route=>{const req=route.request(),resourceURL=new URL(req.url());if(/^pinggai\d*\.caixin\.com$/.test(resourceURL.hostname)||resourceURL.pathname.startsWith('/webjs/comment/')||resourceURL.pathname.startsWith('/modules/cx-audio/'))return route.abort();if(req.isNavigationRequest()&&req.frame()===page.mainFrame()){try{if(!sameArticle(url,req.url()))return route.abort();await checkedURL(req.url())}catch{return route.abort()}}if(['font','media','image'].includes(req.resourceType())||req.isNavigationRequest()&&req.frame()!==page.mainFrame())return route.abort();return route.continue()});
   mark('pageSetup');await page.goto(hint?.url||url,{waitUntil:'commit',timeout:18000});mark('navigation');await settle(page);mark('initialSettle');
   let s=await snapshot(page),nav=pagination(s.html,page.url());base=parseArticle(s.html,url);let expected=hint?.chapters||(staticNav.chapters.length>=nav.chapters.length?staticNav.chapters:nav.chapters);
   if(s.locked)return{...base,access:'restricted',reason:'财新仍显示登录或订阅提示，请在日常 Chrome 确认权限后同步',path:'headless',fetchedAt:new Date().toISOString(),timings,elapsedMs:Date.now()-started};
   mark('initialSnapshot');let expanded=!!hint,readPages=1,notes=[],pending=false;const seen=new Set([page.url()]);
   const all=page.locator('#pageNext a, #pageNext button, #pageBtn a, .page a').filter({hasText:/^(余下全文|查看全部|阅读全文|显示全部)$/}).first();
   if(await all.count()&&await all.isVisible()){
    progress('正在展开全文');const before=await page.locator('#Main_Content_Val').innerText();
    try{const href=await all.getAttribute('href');if(href&&sameArticle(url,new URL(href,page.url()).href)){await page.goto(new URL(href,page.url()).href,{waitUntil:'commit',timeout:12000})}else{await all.click({timeout:4000,noWaitAfter:true});await page.waitForFunction(old=>document.querySelector('#Main_Content_Val')?.innerText!==old,before,{timeout:12000})}await settle(page);s=await snapshot(page);if(!sameArticle(url,page.url()))throw Error('全文跳转到了另一篇文章');const full=parseArticle(s.html,url);base.blocks=mergeBlocks(base.blocks,full.blocks);base.terminalMarker=full.terminalMarker;nav=pagination(s.html,page.url());expanded=true;readPages++;}catch(e){combined.throwIfAborted();notes.push('全文展开未完成，将尝试文章分页')}
   }
   mark('expandAll');if(s.locked)return{...base,access:'restricted',reason:'展开全文时财新要求重新验证权限',path:'headless',fetchedAt:new Date().toISOString(),timings,elapsedMs:Date.now()-started};
   // Only follow discovered article navigation. Never synthesize ?all or page-number URLs.
   let targets=[...(nav.next?[nav.next]:[]),...expected.filter(c=>!textOf(base).includes(c.title))];
   while(targets.length&&readPages<50){
    combined.throwIfAborted();const t=targets.shift();if(seen.has(t.url))continue;seen.add(t.url);if(!sameArticle(url,t.url))continue;
    progress(`正在补齐章节 · ${readPages}`);
    try{await page.goto(t.url,{waitUntil:'commit',timeout:12000});await settle(page);s=await snapshot(page);if(s.locked){notes.push('后续章节受订阅限制');pending=true;break}const part=parseArticle(s.html,url);const old=charCount(base);base.blocks=mergeBlocks(base.blocks,part.blocks);base.terminalMarker=part.terminalMarker;readPages++;if(charCount(base)===old){pending=true;notes.push('分页未返回新正文');break}nav=pagination(s.html,page.url());if(nav.next&&!seen.has(nav.next.url))targets.push(nav.next);
    }catch(e){combined.throwIfAborted();pending=true;notes.push('部分章节未能加载');break}
   }
   mark('pagination');progress('正在核对配图');await lazyMedia(page);const mediaSnap=await snapshot(page);const current=parseArticle(mediaSnap.html,url);
   // Refresh matching lazy URLs/captions without changing paragraph order.
   for(const b of base.blocks.filter(b=>b.type==='image')){const m=current.blocks.find(x=>x.type==='image'&&x.src===b.src);if(m?.caption)b.caption=m.caption}
   mark('mediaAndSnapshot');if(targets.length)pending=true;const result=assess(base,{locked:s.locked,expanded,expected,readPages,hasNext:pending});
   if(result.access==='complete'&&expanded&&sameArticle(url,page.url())){if(this.fullRoutes.size>=500)this.fullRoutes.delete(this.fullRoutes.keys().next().value);this.fullRoutes.set(routeKey,{url:page.url(),chapters:expected})}combined.removeEventListener('abort',stop);if(revision!==this.sessions.state.revision)throw Error('会话已变化，请重新读取');
   return{...base,...result,reason:notes.length?notes.join('；'):result.reason,path:'headless',pagesRead:readPages,fetchedAt:new Date().toISOString(),timings,elapsedMs:Date.now()-started};
  }catch(e){if(signal.aborted)throw Error('读取已取消');throw Error(timeout.aborted?'读取超时，请重试或在财新原文确认登录状态':e.message)}finally{await page?.close().catch(()=>{});this.release()}
 }
}
