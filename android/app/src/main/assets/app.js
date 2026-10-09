'use strict';
const $=s=>document.querySelector(s), app=$('#app'), N=window.ReaderNative;
let saved={};try{saved=JSON.parse(N.restore())}catch{}
let route=saved.route||{type:'shelf',url:'https://weekly.caixin.com/'},stack=saved.stack||[],anchor=saved.anchor||null,seq=0,pending='',data=null,timer,resizing=false;
const publications={caixin:{name:'财新',url:'https://weekly.caixin.com/'},caijing:{name:'财经杂志',url:'https://www.mycaijing.com/issue'},cbnweek:{name:'第一财经',url:'https://www.cbnweek.com/read'}};
let provider=saved.provider||'caixin',readingMode=saved.readingMode||'single',wide=!!saved.wide,spread=0,spreadTotal=1;
if(!publications[provider]){provider='caixin';route={type:'shelf',url:publications.caixin.url};stack=[];anchor=null;}
let theme=saved.theme||'paper',font=saved.font||20;
let shelfYears={};
let cacheRunning=false,cacheResolve=null,cachePending="",cacheEpoch=0,cacheStates={};
try{cacheStates=JSON.parse(localStorage.getItem('library-v2')||'{}')}catch{}

const esc=s=>String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function toast(s){$('#toast').textContent=s;$('#toast').classList.add('show');setTimeout(()=>$('#toast').classList.remove('show'),3000)}
function prefs(){document.body.dataset.theme=theme;document.documentElement.style.setProperty('--size',font+'px');$('#theme').value=theme;$('#font').value=font;document.body.classList.toggle('wide',wide);document.body.dataset.mode=readingMode;requestAnimationFrame(paginate)}
function capture(){if(resizing||!data)return;const blocks=[...document.querySelectorAll('[data-block]')];const b=blocks.find(x=>[...x.getClientRects()].some(r=>r.bottom>75&&r.right>0&&r.left<innerWidth));anchor=b?{block:b.dataset.block,offset:b.getBoundingClientRect().top}: {scroll:scrollY}}
window.saveReading=()=>{capture();N?.save(JSON.stringify({route,stack,anchor,theme,font,provider,readingMode,wide}))};
function restore(){if(!anchor)return;resizing=true;const a=anchor;requestAnimationFrame(()=>{const b=document.querySelector('[data-block="'+Number(a.block)+'"]');if(b)scrollBy(0,b.getBoundingClientRect().top-(a.offset||75));else scrollTo(0,a.scroll||0);setTimeout(()=>resizing=false,150)})}
window.foldChanged=()=>{restore();$('#screen-label').textContent=innerWidth>=700?'展开阅读':'便携阅读'};
addEventListener('resize',window.foldChanged);addEventListener('scroll',()=>{if(!resizing){clearTimeout(timer);timer=setTimeout(saveReading,180)}},{passive:true});
function load(force=false){stopCache(false);pending=String(++seq);data=null;app.innerHTML='<div class="loading"><div class="spinner"></div><h2>正在读取刊物</h2><p id="stage">正在读取本地缓存或官网目录</p></div>';N?.load(route.type,route.url,force,pending)}
function go(type,url){spread=0;stopCache(false);saveReading();stack.push({route,anchor});route={type,url};data=null;anchor=null;scrollTo(0,0);saveReading();load()}
window.readerBack=()=>{if($('#lightbox').open){$('#lightbox').close();return}if($('#account').open){$('#account').close();return}if(stack.length){const p=stack.pop();route=p.route;anchor=p.anchor;load()}else if(route.type!=='shelf'){route={type:'shelf',url:publications[provider].url};anchor=null;load()}else N?.exit()};
window.receiveNative=(id,result)=>{if(id.startsWith('cache-')){if(id===cachePending&&result.state!=='loading'&&cacheResolve){const resolve=cacheResolve;cacheResolve=null;resolve(result)}return}if(id!==pending)return;if(result.state==='loading'){if($('#stage'))$('#stage').textContent=result.stage;return}if(result.state==='error'){if(id.endsWith('-refresh')&&data){toast('更新失败，继续显示本地目录');return}app.innerHTML='<div class="notice"><h2>暂时无法读取</h2><p>'+esc(result.error)+'</p><button data-action="reload">重试</button><button data-action="login">登录当前刊物</button></div>';return}if(result.data?.url&&result.data.url!==route.url){toast('已忽略过期文章响应，请重试');return}data=result.data;render();restore();
if(route.type==='shelf'&&data.cacheHit&&!id.endsWith('-refresh')){pending=String(++seq)+'-refresh';N?.load(route.type,route.url,true,pending)}
};
function render(){setTimeout(setupPages,0);if(route.type==='shelf'){document.body.classList.remove('reading');app.innerHTML='<div class="page-head"><div><p>个人周刊阅读器</p><h1>每周，读懂变化</h1><p>'+publications[provider].name+' · 个人书架</p></div><button data-action="reload">刷新</button></div><label>出版年份 <select id="year"><option value="">全部年份</option>'+[...new Set((data.issues||[]).map(i=>i.year))].sort((a,b)=>b-a).map(y=>'<option>'+y+'</option>').join('')+'</select></label><div class="shelf">'+(data.issues||[]).map(i=>'<button class="book" data-year="'+i.year+'" data-type="issue" data-url="'+esc(i.url)+'"><img loading="lazy" src="'+esc(i.cover)+'" alt="期刊封面"><h3>'+esc(i.title||'财新周刊')+'</h3><p>第 '+esc(i.number)+' 期 · '+esc(i.date)+'</p></button>').join('')+'</div>';}
else if(route.type==='issue'){document.body.classList.remove('reading');app.innerHTML='<div class="issue-cover">'+(data.cover?'<img src="'+esc(data.cover)+'" alt="本期封面">':'')+'<div><p>本期目录</p><h1>'+esc(data.title)+'</h1><p>'+esc(data.meta)+'</p></div><button data-action="reload">刷新</button></div>'+(data.sections||[]).map(s=>'<section><h2>'+esc(s.title)+'</h2><div class="cards">'+s.articles.map(a=>'<button class="card" data-type="article" data-url="'+esc(a.url)+'"><h3>'+esc(a.title)+'</h3><p>'+esc(a.description)+'</p><small>'+esc(a.author)+'</small><span>阅读文章 →</span></button>').join('')+'</div></section>').join('');}
else {document.body.classList.add('reading');let images=0;const blocks=(data.blocks||[]).map((b,i)=>{if(b.type==='image'){images++;return '<figure data-block="'+i+'"><img loading="lazy" src="'+esc(b.src)+'" alt="'+esc(b.caption||'文章配图')+'" data-zoom><figcaption>'+esc(b.caption)+'</figcaption></figure>'}return '<'+(b.type==='heading'?'h2':'p')+' data-block="'+i+'">'+esc(b.text)+'</'+(b.type==='heading'?'h2':'p')+'>'}).join('');app.innerHTML='<div class="reader-actions"><button data-action="shelf">周刊书架</button><select id="read-mode"><option value="single">单栏阅读</option><option value="columns">双栏阅读</option><option value="spread">双屏阅读</option></select><button data-action="width">宽度</button><button data-action="settings">阅读配色</button><button data-action="back">‹ 返回目录</button><span>'+ (data.cacheHit?'本机缓存':Math.round(data.elapsedMs||0)+' ms')+'</span><button data-action="reload">重新读取</button><button data-action="original">原文 ↗</button><button data-action="clear-article">清除本文缓存</button></div><div class="layout"><nav class="toc"><p>本文目录</p><button data-top>文章开头</button>'+(data.chapters||[]).map((c,i)=>'<button data-chapter="'+i+'">'+esc(c.title)+'</button>').join('')+'</nav><article class="paper"><p class="eyebrow">'+publications[provider].name+'</p><h1>'+esc(data.title)+'</h1><p class="meta">'+esc(data.meta)+'</p><p class="description">'+esc(data.description)+'</p><p class="article-state">'+esc(data.reason||'')+' · '+images+' 张配图</p>'+(data.access==='restricted'?'<div class="notice"><button data-action="login">登录当前刊物以读取订阅内容</button></div>':'')+'<div id="article-body">'+blocks+'</div><p class="end">— '+(data.access==='complete'?'全文结束':'请对照原文确认完整性')+' —</p></article></div>';document.querySelectorAll('article img').forEach(img=>{img.addEventListener('load',()=>{if(anchor)restore()});img.addEventListener('error',()=>{img.alt='图片暂未加载，点击重试';img.dataset.failed='1'})});}}
app.addEventListener('click',e=>{const b=e.target.closest('[data-type],[data-action],[data-zoom],[data-chapter],[data-top]');if(!b)return;if(b.dataset.type)go(b.dataset.type,b.dataset.url);else if(b.hasAttribute('data-zoom')){if(b.dataset.failed){delete b.dataset.failed;b.src=b.src.split('?')[0]+'?retry='+Date.now();return}$('#zoom-image').src=b.src;$('#zoom-caption').textContent=b.alt;$('#lightbox').showModal()}else if(b.hasAttribute('data-top'))scrollTo({top:0,behavior:'smooth'});else if(b.dataset.chapter!==undefined){const title=data.chapters[Number(b.dataset.chapter)].title;const target=[...document.querySelectorAll('[data-block]')].find(n=>n.textContent.includes(title));target?.scrollIntoView({behavior:'smooth',block:'start'})}else actions[b.dataset.action]?.()});
const actions={'clear-article':()=>{delete cacheStates[provider]?.completed?.[route.url];persistCache();N?.clearArticle(route.url);toast('本文缓存已清除')},shelf:()=>go('shelf',publications[provider].url),width:()=>{wide=!wide;prefs();saveReading()},settings:()=>$('#settings').click(),reload:()=>{if(route.type==='article'){delete cacheStates[provider]?.completed?.[route.url];persistCache()}load(true)},login:()=>N?.login(publications[provider].url),original:()=>N?.original(route.url),back:()=>readerBack()};
$('#back').onclick=readerBack;$('#home').onclick=()=>go('shelf',publications[provider].url);$('#settings').onclick=()=>{$('#cache-size').textContent=N?.cacheInfo()||'';$('#account').showModal()};$('#login').onclick=()=>{$('#account').close();N?.login(publications[provider].url)};document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>b.closest('dialog').close());$('#zoom-image').onclick=()=>$('#zoom-image').classList.toggle('expanded');$('#theme').onchange=e=>{theme=e.target.value;prefs();saveReading()};$('#font').oninput=e=>{capture();font=Number(e.target.value);prefs();restore();saveReading()};$('#clear').onclick=()=>{if(confirm('清除本机正文和图片缓存？'))N?.clearCache()};$('#logout').onclick=()=>{if(confirm('退出登录，并清除本机缓存？'))N?.disconnect()};
window.loginReturned=()=>{load()};window.cacheCleared=()=>{cacheStates={};localStorage.removeItem('library-v2');$('#account').close();toast('缓存已清除');load(true)};window.disconnected=()=>{$('#account').close();stack=[];anchor=null;route={type:'shelf',url:'https://weekly.caixin.com/'};load(true)};
$('#publication').value=provider;
$('#publication').onchange=e=>{provider=e.target.value;stack=[];go('shelf',publications[provider].url)};
app.addEventListener('change',e=>{
 if(e.target.id==='year'){shelfYears[provider]=e.target.value;document.querySelectorAll('.book').forEach(b=>b.hidden=!!e.target.value&&b.dataset.year!==e.target.value)}
 if(e.target.id==='read-mode'){readingMode=e.target.value;spread=0;prefs();saveReading()}
});
$('#cache-start').onclick=()=>startCache(provider,true);
$('#cache-pause').onclick=()=>stopCache(true);
prefs();foldChanged();load();


function setupPages(){
 if(route.type==='shelf'&&shelfYears[provider]&&$('#year')){$('#year').value=shelfYears[provider];$('#year').dispatchEvent(new Event('change'))}
 if(route.type!=='article')return;
 $('#read-mode').value=readingMode;
 const paper=$('.paper');if(!paper||$('#page-window'))return;
 const viewport=document.createElement('div'),flow=document.createElement('div');viewport.id='page-window';flow.id='page-flow';
 while(paper.firstChild)flow.append(paper.firstChild);viewport.append(flow);paper.append(viewport);
 paper.insertAdjacentHTML('beforeend','<div class="page-nav"><button id="prev">‹ 上一页</button><span id="page-count"></span><button id="next">下一页 ›</button></div>');
 $('#prev').onclick=()=>{spread=Math.max(0,spread-1);paginate();saveReading()};$('#next').onclick=()=>{spread=Math.min(spreadTotal-1,spread+1);paginate();saveReading()};
 flow.querySelectorAll('img').forEach(i=>{i.loading='eager';i.addEventListener('load',paginate)});prefs();
}
function paginate(keepAnchor=false){
 const viewport=$('#page-window'),flow=$('#page-flow');if(!viewport)return;
 if(readingMode!=='spread'){viewport.style.height='';flow.style.transform='';return}
 viewport.style.height=Math.max(240,innerHeight-170)+'px';
 viewport.style.setProperty('--page-height',viewport.style.height);
 const step=viewport.getBoundingClientRect().width+32;
 if(keepAnchor===true&&anchor?.block){const el=document.querySelector('[data-block="'+Number(anchor.block)+'"]');if(el)spread=Math.max(0,Math.floor((el.getClientRects()[0].left-flow.getBoundingClientRect().left)/step))}
 spreadTotal=Math.max(1,Math.ceil((flow.scrollWidth+31)/step));spread=Math.min(spread,spreadTotal-1);
 flow.style.transform='translateX('+(-step*spread)+'px)';
 $('#prev').disabled=spread===0;$('#next').disabled=spread===spreadTotal-1;$('#page-count').textContent=(spread+1)+' / '+spreadTotal;
}
addEventListener('resize',()=>requestAnimationFrame(()=>paginate(true)));
addEventListener('keydown',e=>{if(readingMode!=='spread'||document.querySelector('dialog[open]')||e.target.closest('select,input,textarea'))return;if(e.key==='PageDown'||e.key==='PageUp'){e.preventDefault();(e.key==='PageDown'?$('#next'):$('#prev'))?.click()}});
function cacheStatus(text){$('#cache-progress').textContent=text}
function persistCache(){localStorage.setItem('library-v2',JSON.stringify(cacheStates))}
function stopCache(manual){
 if(cacheRunning){cacheEpoch++;cacheRunning=false;N?.cancel();if(cacheResolve){cacheResolve({state:'error',error:'paused'});cacheResolve=null}}
 if(manual){cacheStates[provider]={...cacheStates[provider],enabled:false};persistCache();cacheStatus('已暂停')}
}
function cacheLoad(type,url,force=false){return new Promise(resolve=>{cacheResolve=resolve;cachePending='cache-'+(++seq);N.load(type,url,force,cachePending)})}
async function startCache(p,manual=false){
 if(cacheRunning)return;cacheRunning=true;const epoch=++cacheEpoch;
 const state=cacheStates[p]||{};state.enabled=false;state.nextCheck=null;state.completed=state.completed||{};cacheStates[p]=state;persistCache();
 try{
  cacheStatus(publications[p].name+' · 检查新刊');
  let result=await cacheLoad('shelf',publications[p].url,true);
  if(result.state!=='done')throw Error(result.error);
  const list=[...(result.data.issues||[])].sort((a,b)=>String(b.date).localeCompare(String(a.date))).slice(0,100);
  let count=0,skipped=0,failed=0;
  for(const issue of list){
   if(epoch!==cacheEpoch)return;
   result=await cacheLoad('issue',issue.url);if(result.state!=='done')throw Error(result.error);
   const entries=(result.data.sections||[]).flatMap(s=>s.articles),seen=new Set();
   for(const article of entries){
    if(epoch!==cacheEpoch)return;if(seen.has(article.url))continue;seen.add(article.url);if(state.completed[article.url]){skipped++;cacheStatus('已保留 '+skipped+' 篇完整文章');continue;}
    cacheStatus(publications[p].name+' · '+(count+1)+'/'+list.length+'期 · '+article.title);
    await new Promise(r=>setTimeout(r,2000));if(epoch!==cacheEpoch)return;const item=await cacheLoad('article',article.url);
    if(item.state!=='done'){throw Error(item.error||'读取失败，已暂停')}
    if(!item.data.blocks?.length)throw Error('官网返回空正文，已暂停');if(item.data.access==='restricted')throw Error('请登录并确认订阅权限');
    if(item.data.access!=='complete'||item.data.cacheWarning){failed++;continue;}
    if(item.data.cacheHit)skipped++;state.completed[article.url]=true;persistCache();
   }count++;state.progress=count+'/'+list.length+'期';persistCache();
  }
  state.nextCheck=null;state.progress='本轮完成，跳过 '+skipped+' 篇，待重试 '+failed+' 篇';persistCache();cacheStatus(publications[p].name+' · '+state.progress);
 }catch(e){if(epoch===cacheEpoch){state.nextCheck=null;state.progress=e.message;persistCache();cacheStatus('暂停：'+e.message)}}
 finally{if(epoch===cacheEpoch)cacheRunning=false}
}
