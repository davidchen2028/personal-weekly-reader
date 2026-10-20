let spreadIndex=0,spreadCount=1,paginationFrame=0,paginationObserver;
let shelfRefresh=null;
const $=s=>document.querySelector(s),app=$('#app');
const esc=s=>String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let issues=[],currentIssue=null,version=0,activeRead=null,currentArticle=null;let prefs;try{prefs=JSON.parse(localStorage.getItem('reading')||'{}')}catch{prefs={}}
const provider=new URLSearchParams(location.search).get('provider')||(location.hash?'caixin':localStorage.getItem('provider')||'caixin');
const publication=provider==='cbnweek'?'第一财经':provider==='caijing'?'财经杂志':provider==='eeo'?'经济观察报':'财新周刊',publisher=provider==='cbnweek'?'第一财经':provider==='caijing'?'财经杂志':provider==='eeo'?'经济观察报':'财新';
$('#caijing-rate').hidden=provider!=='caijing';
$('#brand-name').textContent=publisher;document.title=publisher+' · 个人周刊阅读器';
localStorage.setItem('provider',provider);document.body.dataset.provider=provider;
$('#provider').value=provider;$('#provider').onchange=e=>{location.href='?provider='+e.target.value};
const route=(type,url)=>`#${type}/${encodeURIComponent(url)}`;
async function api(path,body){const r=await fetch('/api/'+path+(path.includes('?')?'&':'?')+'provider='+provider,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});const data=await r.json();if(!r.ok)throw Error(data.error||'读取失败');return data}
function toast(s){$('#toast').textContent=s;$('#toast').classList.add('show');setTimeout(()=>$('#toast').classList.remove('show'),4500)}
function cover(i){return `<img src="${esc(i.cover)}" alt="${esc(i.title)}封面" loading="lazy">`}
async function cancelRead(){const job=activeRead;activeRead=null;if(job)await api('read/'+job.jobId+'/cancel',{subscriber:job.subscriber}).catch(()=>{})}
async function readArticle(url,v,refresh){const started=await api('read',{url,refresh});if(started.result)return started.result;if(v!==version){await api('read/'+started.jobId+'/cancel',{subscriber:started.subscriber});return null}activeRead=started;while(v===version){const state=await api('read/'+started.jobId);if(v!==version)return null;if(state.state==='done'){activeRead=null;return state.result}if(state.state==='error'){activeRead=null;throw Error(state.error)}const label=$('.loading');if(label)label.textContent=state.stage;await new Promise(resolve=>setTimeout(resolve,100))}return null}
async function render(force=false){const v=++version;disposePagination();cancelRead();document.body.classList.remove('reading','issue-view');app.innerHTML=`<div class="loading" role="status">正在读取${publisher}<span>正在发现期刊和目录，请稍候</span></div>`;window.scrollTo(0,0);try{const [type,raw]=location.hash.slice(1).split('/');const url=raw?decodeURIComponent(raw):'';if(type==='issue'){const data=await api('issue?url='+encodeURIComponent(url));if(v!==version)return;currentIssue=data;renderIssue(data)}else if(type==='article'){const data=await readArticle(url,v,force===true);if(v!==version||!data)return;renderArticle(data)}else{if(!issues.length)issues=await api('issues');if(v!==version)return;renderShelf();refreshShelfInBackground()}}catch(e){if(v===version){app.innerHTML=`<div class="error"><h2>暂时无法读取</h2><p>${esc(e.message)}</p><button id="retry">重新加载</button> <a href="#">返回书架</a></div>`;$('#retry').onclick=()=>render(true)}}}
function renderShelf(){const years=[...new Set(issues.map(i=>i.year))];app.innerHTML=`<div class="page-heading"><div><div class="eyebrow">${provider==='cbnweek'?'CBN WEEKLY':provider==='caijing'?'CAIJING MAGAZINE':provider==='eeo'?'ECONOMIC OBSERVER':'CAIXIN WEEKLY'} · 个人阅读</div><h1>每一期，值得深读。</h1></div><div class="shelf-meta">${publication}<span>从封面出发，看见全貌</span></div></div><div class="shelf-bar"><h2>周刊书架</h2><label>出版年份 <select id="year">${years.map(y=>`<option>${y}</option>`).join('')}</select></label>${['caijing','cbnweek'].includes(provider)?'<label>期刊类型 <select id="issue-type"><option value="all">全部</option><option value="0">常规期刊</option><option value="1">'+(provider==='cbnweek'?'单行本':'增刊')+'</option></select></label>':''}<span id="count"></span><span id="shelf-sync" role="status"></span><button id="refresh" class="text-button">↻ ${provider==='eeo'?'重新扫描目录':'更新书架'}</button></div><div class="shelf" id="shelf"></div>`;function filter(){const list=issues.filter(i=>i.year===Number($('#year').value)&&(!$('#issue-type')||$('#issue-type').value==='all'||String(i.issueType)===$('#issue-type').value));$('#count').textContent=`${list.length} 期`;$('#shelf').innerHTML=list.map(i=>`<a class="book" data-issue-url="${esc(i.url)}" href="${route('issue',i.url)}"><div class="book-image">${cover(i)}${i.finished?'<span class="finished-badge">✓ 读完</span>':''}<span class="book-open">阅读本期 ↗</span></div><div class="book-meta">${i.issueType===1?(provider==='cbnweek'?'单行本 · ':'增刊 · '):''}${i.number?'NO. '+esc(i.number):''}<span>${esc(i.date.replace(/年|月/g,'.').replace('日',''))}</span></div><h3>${esc(i.title)}</h3></a>`).join('');refreshCacheBadges()}$('#year').onchange=filter;if($('#issue-type'))$('#issue-type').onchange=filter;filter();$('#refresh').onclick=e=>action(e.target,async()=>{await refreshShelfInBackground()})}
let cacheBadgeRequest=0;
async function refreshCacheBadges(){
 const shelf=$('#shelf');if(!shelf)return;
 const request=++cacheBadgeRequest,books=[...shelf.querySelectorAll('.book')];
 try{const cached=new Map();for(let i=0;i<books.length;i+=100){const result=await api('library/issues',{urls:books.slice(i,i+100).map(b=>b.dataset.issueUrl)});if(request!==cacheBadgeRequest||shelf!==$('#shelf'))return;for(const item of result.issues||[])cached.set(item.url,item)}
 for(const book of books){const item=cached.get(book.dataset.issueUrl);let finished=book.querySelector('.finished-badge');if(item?.finished){if(!finished){finished=document.createElement('span');finished.className='finished-badge';finished.textContent='✓ 读完';book.querySelector('.book-image').append(finished)}}else finished?.remove();let badge=book.querySelector('.cache-badge'),note=book.querySelector('.cache-note');if(item&&item.state!=='none'){if(!badge){badge=document.createElement('span');book.querySelector('.book-image').append(badge)}badge.className='cache-badge '+item.state;badge.textContent=item.state==='complete'?'✓ 已缓存':item.state==='mostly'?'✓ 已缓存 · 主体可读':'部分缓存';const detail=`共 ${item.total} 篇：完整 ${item.complete} 篇，本地可读但待核验 ${item.readable-item.complete} 篇，缺失或未取齐 ${item.missing} 篇；缺图 ${item.missingImages} 张`;badge.title=detail;if(item.state!=='complete'){if(!note){note=document.createElement('p');note.className='cache-note';book.append(note)}note.textContent=`可读 ${item.readable}/${item.total} 篇 · ${item.pending} 篇待处理`;note.title=detail}else note?.remove()}else{badge?.remove();note?.remove()}}

 }catch{} // Keep the shelf usable if local status is temporarily unavailable.
}
function renderIssue(d){document.body.classList.add('issue-view');app.innerHTML=`<a class="back" href="#">← 周刊书架</a><div class="issue-layout"><aside class="issue-aside">${cover(d)}<div class="issue-reading-status"><button id="toggle-finished" aria-pressed="${!!d.finished}" aria-label="${d.finished?'取消读完':'标记读完'}"><span class="finished-default">${d.finished?'✓ 读完':'标记读完'}</span><span class="finished-hover" aria-hidden="true">取消读完</span></button></div><div class="eyebrow">本期目录 · ${d.sections.reduce((n,s)=>n+s.articles.length,0)} 篇</div><nav>${d.sections.map((s,i)=>`<a href="#section-${i}" data-section="${i}">${esc(s.title)}</a>`).join('')}</nav><a class="source" href="${esc(d.url)}" target="_blank" rel="noreferrer">在${publisher}打开本期 ↗</a></aside><div class="issue-content"><div class="eyebrow">${provider==='cbnweek'?'CBN WEEKLY':provider==='caijing'?'CAIJING MAGAZINE':provider==='eeo'?'ECONOMIC OBSERVER':'CAIXIN WEEKLY'}</div><h1>${esc(d.title)}</h1><p class="muted">${esc(d.meta)}</p>${d.sections.map((s,i)=>`<section class="category ${i===0?'cover-story':''}" id="section-${i}"><h2><span>${String(i+1).padStart(2,'0')}</span>${esc(s.title)}</h2><div class="article-grid">${s.articles.map(a=>`<a href="?provider=${provider}&issue=${encodeURIComponent(d.url)}${route('article',a.url)}" target="_blank" rel="noopener" class="article-card"><h3>${esc(a.title)} <span>↗</span></h3><p>${esc(a.description)}</p>${a.author?`<small>${esc(a.author)}</small>`:''}</a>`).join('')}</div></section>`).join('')}</div></div>`;$('#toggle-finished').onclick=async e=>{const button=e.currentTarget;button.disabled=true;try{const result=await api('reading-state',{url:d.url,finished:!d.finished});d.finished=result.finished;const known=issues.find(i=>i.url===d.url);if(known)known.finished=d.finished;if(button.isConnected){button.querySelector('.finished-default').textContent=d.finished?'✓ 读完':'标记读完';button.setAttribute('aria-pressed',String(d.finished));button.setAttribute('aria-label',d.finished?'取消读完':'标记读完')}}catch(error){toast(error.message)}finally{button.disabled=false}};document.querySelectorAll('[data-section]').forEach(el=>el.onclick=e=>{e.preventDefault();$('#section-'+el.dataset.section).scrollIntoView({behavior:'smooth',block:'start'})})}
function savePrefs(){localStorage.setItem('reading',JSON.stringify(prefs));applyPrefs()}
function applyPrefs(){document.body.classList.toggle('wide-reading',!!prefs.wide);if($('#wide-reading')){$('#wide-reading').textContent=prefs.wide?'标准宽度':'宽屏阅读';$('#wide-reading').setAttribute('aria-pressed',String(!!prefs.wide))}document.body.dataset.theme=prefs.theme||'white';document.documentElement.style.setProperty('--reading-size',(prefs.size||20)+'px');const mode=prefs.mode||(prefs.columns?'columns':'single');$('#article-body')?.classList.toggle('columns',mode==='columns');if($('#reading-mode'))$('#reading-mode').value=mode;document.body.classList.toggle('paged-reading',mode==='spread');schedulePagination()}
const accessLabel={complete:'全文已核对',partial:'正文未取齐',unverified:'完整性待确认',preview:'当前为预览',restricted:'需要确认'+publisher+'订阅权限'};
function renderArticle(d){currentArticle=d;const issueUrl=currentIssue?.url||new URLSearchParams(location.search).get('issue');document.body.classList.add('reading');app.innerHTML=`<div class="reader-dock"><a class="back" href="${issueUrl?route('issue',issueUrl):'#'}">← ${issueUrl?'本期目录':'周刊书架'}</a><a class="shelf-return" href="#">周刊书架</a><select id="reading-mode" aria-label="阅读模式"><option value="single">单栏阅读</option><option value="columns">双栏阅读</option><option value="spread">双屏阅读</option></select><button id="wide-reading" aria-pressed="false">宽屏阅读</button><details class="reader-settings"><summary>阅读设置</summary><div class="reading-tools" aria-label="阅读设置"><button id="smaller" aria-label="缩小字号">A−</button><button id="larger" aria-label="放大字号">A＋</button><button id="reload">↻ 刷新全文</button><button id="clear-article">清除本文缓存</button><a class="source" href="${esc(d.sourceUrl||d.url)}" target="_blank" rel="noreferrer">原站 ↗</a></div></details><select id="theme" aria-label="阅读配色"><option value="white">纸白</option><option value="sepia">护眼</option><option value="dark">夜间</option><option value="cream">奶油书页</option><option value="parchment">羊皮纸</option><option value="sage">豆沙绿</option><option value="mint">薄荷青</option><option value="mist">雾蓝</option><option value="gray">银灰</option><option value="rose">浅玫瑰</option><option value="lavender">淡紫</option><option value="coffee">深咖</option><option value="forest">松林夜色</option><option value="midnight">午夜蓝</option><option value="ink">墨黑</option></select><a class="original-link" href="${esc(d.sourceUrl||d.url)}" target="_blank" rel="noopener noreferrer" title="在新标签页打开原文网页">原文 ↗</a></div><article class="paper"><div class="article-heading"><h1>${esc(d.title)}</h1><p class="muted">${esc(d.meta)}</p><div class="article-state"><span class="state-${d.access}">${esc(accessLabel[d.access]||'当前可见内容')}</span><span id="image-status"></span>${d.cacheHit?`<span>本机缓存 · ${new Date(d.fetchedAt).toLocaleString()}</span>`:''}</div>${d.description?`<p class="abstract">${esc(d.description)}</p>`:''}</div><div id="article-body">${d.blocks.map((b,i)=>b.type==='image'?`<figure data-image="${i}"><button class="image-open" aria-label="放大图片 ${i+1}"><img src="${esc(b.src)}" alt="${esc(b.caption||'文章配图')}" loading="eager"></button><figcaption>${esc(b.caption)}</figcaption><button class="image-retry" hidden>图片加载失败 · 重试</button></figure>`:b.type==='heading'?`<h2>${esc(b.text)}</h2>`:`<p>${esc(b.text)}</p>`).join('')}</div>${d.access!=='complete'?`<div class="access-note">${esc(d.reason||'请在原文确认阅读权限和内容完整性。')} <button id="article-login">管理连接</button></div>`:''}<div class="reading-end">${publisher} · ${esc(accessLabel[d.access]||'当前可见内容')}</div></article>`;
setupPagination();
$('#wide-reading').onclick=()=>{prefs.wide=!prefs.wide;savePrefs()};$('#theme').value=prefs.theme||'white';$('#theme').onchange=e=>{prefs.theme=e.target.value;savePrefs()};$('#smaller').onclick=()=>{prefs.size=Math.max(16,(prefs.size||20)-2);savePrefs()};$('#larger').onclick=()=>{prefs.size=Math.min(32,(prefs.size||20)+2);savePrefs()};$('#reading-mode').onchange=e=>{prefs.mode=e.target.value;savePrefs()};$('#reload').onclick=()=>render(true);$('#clear-article').onclick=e=>action(e.target,async()=>{await api('cache/clear',{url:d.url});toast('本文缓存已清除，下次打开时重新读取')});if($('#article-login'))$('#article-login').onclick=openAccount;applyPrefs();
const figs=[...document.querySelectorAll('figure[data-image]')];const update=()=>{const loaded=figs.filter(f=>f.querySelector('img').complete&&f.querySelector('img').naturalWidth>0).length;$('#image-status').textContent=figs.length?`图片 ${loaded}/${figs.length}`:''};
for(const f of figs){const img=f.querySelector('img'),retry=f.querySelector('.image-retry');img.onload=()=>{retry.hidden=true;update();schedulePagination()};img.onerror=()=>{retry.hidden=false;update();schedulePagination()};retry.onclick=()=>{retry.hidden=true;const retryURL=new URL(img.src);retryURL.searchParams.set('retry',Date.now());img.src=retryURL.href};f.querySelector('.image-open').onclick=()=>{if(!img.naturalWidth)return;const dlg=$('#image-viewer');dlg.querySelector('img').src=img.src;dlg.querySelector('img').alt=img.alt;dlg.querySelector('p').textContent=f.querySelector('figcaption').textContent;dlg.showModal()};if(img.complete&&!img.naturalWidth)retry.hidden=false}update();
}
async function connectionStatus(){await syncOverview();const s=await api('status');$('#connect').textContent=s.paired?'管理 Chrome 同步':s.hasSession?'管理本机会话':'连接'+publisher+'帐号';$('#status').textContent=s.hasSession?`会话已同步${s.lastSync?' · '+new Date(s.lastSync).toLocaleString():''}。实际阅读权限由${publisher}确认。`:s.paired?`扩展已配对，尚未同步到${publisher} Cookie。请在日常 Chrome 登录后选择对应刊物，点击扩展「立即同步」。`:'尚未连接日常 Chrome。';$('#cache-info').textContent=`${s.cache.count} 篇临时缓存 · ${(s.cache.bytes/1024/1024).toFixed(1)} MB；长期存档 ${(s.archive.bytes/1024/1024).toFixed(1)} MB`;return s}
function openAccount(){$('#account').showModal();connectionStatus().catch(e=>$('#status').textContent=e.message)}
$('#connect').onclick=openAccount;
async function action(button,fn){button.disabled=true;try{await fn()}catch(e){toast(e.message);$('#status').textContent=e.message}finally{button.disabled=false}}
$('#pair').onclick=e=>action(e.target,async()=>{const p=await api('pair-code',{});$('#pair-code').textContent=p.code;$('#status').textContent='配对码 5 分钟内有效。在 Chrome 扩展弹窗输入此码。'});
$('#copy-path').onclick=e=>action(e.target,async()=>{const s=await api('status');await navigator.clipboard.writeText(s.extensionPath);toast('扩展目录已复制')});
$('#check-session').onclick=e=>action(e.target,connectionStatus);
$('#import').onclick=e=>action(e.target,async()=>{const raw=$('#cookies').value.trim();await api('cookies',{cookies:raw.startsWith('[')?JSON.parse(raw):raw});$('#cookies').value='';await connectionStatus();toast('Cookie 已导入，点击刷新全文重新读取')});
$('#disconnect').onclick=e=>action(e.target,async()=>{await api('disconnect',{});$('#pair-code').textContent='';await connectionStatus();if(location.hash.startsWith('#article'))render(true)});
$('#clear-cache').onclick=e=>action(e.target,async()=>{await api('cache/clear',{});await connectionStatus();toast('所有文章缓存已清除')});
window.addEventListener('hashchange',()=>render());window.addEventListener('pagehide',()=>cancelRead());render();connectionStatus().catch(()=>{});

const libraryLabels={idle:'尚未开始',running:'正在缓存',waiting:'等待登录',paused:'已暂停',interrupted:'待恢复',done:'已完成',partial:'部分失败',blocked:'需要检查订阅权限',error:'同步失败'};
async function libraryStatus(){const s=await api('library/status');$('#cache-all').disabled=s.running;$('#cache-all').textContent=s.running?'最近20期缓存中…':'缓存最近20期 · '+publisher;$('#library-summary').textContent=`本地缓存：${libraryLabels[s.state]||s.state}`;$('#library-progress').textContent=`${s.current||s.message||''} · 本地台账：完整 ${s.storedComplete||0} 篇 / 待处理 ${s.storedPending||0} 篇 · 本轮杂志 ${s.issuesDone||0}/${s.issueCount||0} · 文章完成 ${s.articlesDone||0} / 已发现 ${s.articlesTotal||0} · 本轮已跳过 ${s.skipped||0} · 待处理已跳过 ${s.deferred||0} · 配图处理 ${s.imagesDone||0} · 失败 ${s.errorCount||0}。${s.message||''} ${s.enabled&&s.nextCheck?'下次检查：'+new Date(s.nextCheck).toLocaleString():''}`;$('#library-errors').innerHTML=(s.errors||[]).map(e=>`<li>${esc(e.message)} · <a href="${esc(e.url)}" target="_blank" rel="noreferrer">查看原文</a></li>`).join('');refreshCacheBadges();}
$('#cache-all').onclick=e=>action(e.target,async()=>{$('#library-panel').open=true;await api('library/start',{});await libraryStatus()});
$('#library-retry').onclick=e=>action(e.target,async()=>{await api('library/retry',{});await libraryStatus()});
$('#library-pause').onclick=e=>action(e.target,async()=>{await api('library/pause',{});await libraryStatus()});
$('#library-clear').onclick=e=>action(e.target,async()=>{if(!confirm('清除全部长期存档正文和图片，并暂停自动同步？'))return;await api('library/clear',{});await libraryStatus();toast('长期存档已清除；目录索引保留，点击全部缓存可重新下载')});
libraryStatus().catch(()=>{});setInterval(()=>libraryStatus().catch(()=>{}),5000);

$('#account-title').textContent='连接'+publisher+'帐号';$('#account-intro').textContent='在日常 Chrome 中登录各刊网站，一个配对码即可同步四刊。首次使用新增刊物请重新加载扩展 4.0.0，并授权对应站点。';

async function syncOverview(){const r=await fetch('/api/sync-status');if(!r.ok)return;const rows=await r.json();const names={caixin:'财新',eeo:'经济观察报',caijing:'财经杂志',cbnweek:'第一财经'};$('#sync-overview').innerHTML='<h3>四刊连接状态</h3>'+rows.map(s=>`<div class="sync-row"><strong>${names[s.provider]}</strong><span>${s.disabled?'已断开':s.hasSession?'凭证已送达，权益待文章验证':'未连接'} · Cookie ${s.cookieCount??0} 项${s.provider==='cbnweek'?' · 令牌'+(s.hasToken?'已收到':'未收到'):''}</span><small>本机最近收到：${s.lastSync?new Date(s.lastSync).toLocaleString():'—'}</small></div>`).join('')+'<p>最近尝试和错误原因请查看 Chrome 扩展的四刊面板。</p>'}

document.addEventListener("keydown",e=>{if(e.key==="Escape"){const settings=document.querySelector(".reader-settings");if(settings)settings.open=false}});

// A single DOM flow is fragmented by the browser, so paragraphs are never copied or truncated.

function disposePagination(){
 cancelAnimationFrame(paginationFrame);paginationObserver?.disconnect();
 document.body.classList.remove('paged-reading');spreadIndex=0;spreadCount=1;
}
function setupPagination(){
 const paper=$('.paper'),viewport=document.createElement('div'),flow=document.createElement('div');
 viewport.id='spread-viewport';flow.id='spread-flow';
 while(paper.firstChild)flow.append(paper.firstChild);
 viewport.append(flow);paper.append(viewport);
 paper.insertAdjacentHTML('beforeend','<nav class="page-controls" aria-label="文章翻页" hidden><button id="previous-page">‹ 上一页</button><span id="page-position" role="status" aria-live="polite"></span><button id="next-page">下一页 ›</button></nav>');
 $('#previous-page').onclick=()=>turnPage(-1);$('#next-page').onclick=()=>turnPage(1);
 paginationObserver=new ResizeObserver(schedulePagination);paginationObserver.observe(viewport);paginationObserver.observe($('.reader-dock'));
 document.fonts.ready.then(schedulePagination);
}
function schedulePagination(){cancelAnimationFrame(paginationFrame);paginationFrame=requestAnimationFrame(layoutPages)}
function layoutPages(){
 const viewport=$('#spread-viewport'),flow=$('#spread-flow');if(!viewport)return;
 const paged=document.body.classList.contains('paged-reading');
 $('.page-controls').hidden=!paged;
 if(!paged){flow.style.transform='';viewport.style.height='';return}
 // Reserve space for the compact toolbar, paper padding, and page controls.
 const paper=$('.paper'),padding=parseFloat(getComputedStyle(paper).paddingTop)+parseFloat(getComputedStyle(paper).paddingBottom);
 const height=Math.max(240,innerHeight-$('.reader-dock').offsetHeight-padding-100);
 viewport.style.height=height+'px';viewport.style.setProperty('--spread-height',height+'px');
 const gap=parseFloat(getComputedStyle(flow).columnGap)||0;
 const stride=viewport.getBoundingClientRect().width+gap;
 spreadCount=Math.max(1,Math.ceil((flow.scrollWidth+gap-1)/stride));
 spreadIndex=Math.min(spreadIndex,spreadCount-1);
 flow.style.transform='translateX('+(-spreadIndex*stride)+'px)';
 $('#previous-page').disabled=spreadIndex===0;$('#next-page').disabled=spreadIndex===spreadCount-1;
 $('#page-position').textContent=(spreadIndex+1)+' / '+spreadCount+' · '+(innerWidth>760?'双屏':'单屏')+'翻页';
}
function turnPage(direction){
 spreadIndex=Math.max(0,Math.min(spreadCount-1,spreadIndex+direction));layoutPages();
}
window.addEventListener('resize',schedulePagination);
document.addEventListener('keydown',event=>{
 if(!document.body.classList.contains('paged-reading')||!['PageUp','PageDown'].includes(event.key))return;
 if(event.ctrlKey||event.metaKey||event.altKey||document.querySelector('dialog[open]')||event.target.closest('input,textarea,select,[contenteditable="true"]'))return;
 event.preventDefault();turnPage(event.key==='PageDown'?1:-1);
});

// Render the persisted local catalog first. Revalidation must never replace another route.
function refreshShelfInBackground(){
 const status=$('#shelf-sync');if(status)status.textContent='正在后台检查新刊…';
 if(shelfRefresh)return shelfRefresh;
 shelfRefresh=(async()=>{
  try{
   const fresh=await api('issues?refresh=1');
   if(!Array.isArray(fresh)||!fresh.length)throw Error('未获取到有效目录');
   const changed=JSON.stringify(issues)!==JSON.stringify(fresh);issues=fresh;
   if(!$('#shelf'))return;
   if(changed){
    const year=$('#year').value,type=$('#issue-type')?.value,scrollY=window.scrollY;
    renderShelf();
    if([...$('#year').options].some(o=>o.value===year))$('#year').value=year;
    if($('#issue-type')&&type)$('#issue-type').value=type;
    $('#year').dispatchEvent(new Event('change'));window.scrollTo(0,scrollY);
   }
   $('#shelf-sync').textContent=changed?'目录已更新并缓存':'已是最新目录';
  }catch(e){if($('#shelf-sync'))$('#shelf-sync').textContent='更新失败，保留本地目录；可点击更新书架重试'}
  finally{shelfRefresh=null}
 })();
 return shelfRefresh;
}
