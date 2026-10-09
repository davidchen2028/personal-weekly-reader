(function(){
 'use strict';
 const clean=s=>(s||'').replace(/\s+/g,' ').trim();
 const safe=raw=>{try{if(!raw)return '';const u=new URL(raw,location.href);if(u.protocol==='http:'&&(u.hostname==='caixin.com'||u.hostname.endsWith('.caixin.com')))u.protocol='https:';return u.protocol==='https:'&&(u.hostname==='caixin.com'||u.hostname.endsWith('.caixin.com'))&&!u.username&&!u.password&&!u.port?u.href:''}catch{return ''}};
 const img=e=>safe(e?.getAttribute('data-original')||e?.getAttribute('data-src')||e?.getAttribute('src')||e?.currentSrc);
 const text=(root,sel)=>clean(root.querySelector(sel)?.textContent);
 const mode=__MODE__;
 if(mode==='shelf'){
  const seen=new Set(),issues=[];document.querySelectorAll('li a[href]').forEach(a=>{const url=safe(a.getAttribute('href'));if(!/\/\d{4}\/cw\d+\//.test(url)||!a.querySelector('img')||seen.has(url))return;seen.add(url);const meta=clean(a.closest('li').textContent);issues.push({url,title:clean(a.textContent),cover:img(a.querySelector('img')),number:url.match(/cw(\d+)/)[1],year:Number(meta.match(/(\d{4})年\d{2}月\d{2}日/)?.[1]||url.match(/\/(\d{4})\/cw/)[1]),date:meta.match(/\d{4}年\d{2}月\d{2}日/)?.[0]||''})});
  return issues.length?{ready:true,data:{issues}}:{ready:false};
 }
 if(mode==='issue'){
  const sections=[];const add=(title,nodes)=>{const articles=[];nodes.forEach(n=>{const a=n.querySelector('dt a');if(!a)return;const url=safe(a.getAttribute('href'));if(url)articles.push({url,title:clean(a.textContent),author:text(n,'dd.date'),description:[...n.querySelectorAll('dd:not(.date)')].map(e=>clean(e.textContent)).join(' ')})});if(articles.length)sections.push({title,articles})};
  add('封面报道',[...document.querySelectorAll('.magazine-container dl')]);document.querySelectorAll('.magIntrotit').forEach(e=>{const nodes=[];let n=e.nextElementSibling;while(n&&!n.classList.contains('magIntrotit')){if(n.tagName==='DL')nodes.push(n);n=n.nextElementSibling}add(text(e,'span')||clean(e.textContent),nodes)});
  return sections.length?{ready:true,data:{url:location.href,title:text(document,'.magazine-container .title')||document.title,meta:text(document,'.magazine-container .source'),cover:img(document.querySelector('.cover img')),sections}}:{ready:false};
 }
 const root=document.querySelector('#Main_Content_Val');if(!root)return{ready:false};
 const hidden=e=>{for(let n=e;n&&n!==document.body;n=n.parentElement){const s=getComputedStyle(n);if(s.display==='none'||s.visibility==='hidden'||((s.opacity==='0'||s.fontSize==='0px')&&e.tagName!=='IMG'&&!e.querySelector('img')))return true}return false};
 const wall=document.querySelector('#chargeWall');const locked=!!wall&&!hidden(wall)&&wall.getBoundingClientRect().height>20&&clean(wall.innerText).length>0;
 const id=u=>{try{return new URL(u).pathname.match(/\/(\d+)(?:_\d+)?\.html$/)?.[1]}catch{return null}};
 const links=[...document.querySelectorAll('#pageNext a,#pageNav a,.page a')].map(a=>({text:clean(a.textContent),url:safe(a.getAttribute('href'))}));
 const chapters=links.filter(a=>/^\d+\s*\S/.test(a.text)).map(a=>({title:a.text.replace(/^\d+\s*/,''),url:a.url}));
 const same=a=>a.url&&id(a.url)===id(location.href)&&new URL(a.url).hostname===location.hostname;
 const all=links.find(a=>same(a)&&/^(余下全文|查看全部|阅读全文|显示全部)$/.test(a.text));
 const next=links.find(a=>same(a)&&/^下一页/.test(a.text));
 const blocks=[];const emit=(s,type='paragraph')=>{s=clean(s);if(s&&!s.startsWith('请务必')&&!s.startsWith('Kimi，请务必'))blocks.push({type,text:s})};
 const photo=(e,caption='')=>{const src=img(e);if(src&&!/loading|placeholder|transparent|blank\.(gif|png)|favicon\.ico/i.test(src))blocks.push({type:'image',src,caption:clean(caption||e.alt)})};
 function walk(e){if(e.nodeType===3){emit(e.textContent);return}if(e.nodeType!==1||hidden(e)||e.matches('script,style,iframe,.pip,[name=pIpObj],.advertisement,.end_ico,#chargeWall,#pageNext,[hidden],[aria-hidden=true]'))return;
  const tag=e.tagName;if(tag==='IMG'){photo(e);return}
  if(e.matches('figure,dl,.media_pic,.article_media_pic,.article_img_container')&&e.querySelector('img')){const caption=[...e.querySelectorAll('figcaption,dd,.caption,.picIntro,.article_img_talk')].map(n=>clean(n.textContent)).join(' ');e.querySelectorAll('img').forEach(n=>photo(n,caption));return}
  if(tag==='P'||/^H[1-6]$/.test(tag)){if(!e.querySelector('img,figure,dl,p,h2,h3')){emit(e.textContent,tag==='P'?'paragraph':'heading');return}let buffer='';const flush=()=>{emit(buffer);buffer=''};const inline=n=>{if(n.nodeType===3)buffer+=n.textContent;else if(n.nodeType===1&&!n.matches('.end_ico,script,style')&&!hidden(n)){if(n.matches('img,figure,dl')){flush();walk(n)}else if(n.tagName==='BR')buffer+='\n';else n.childNodes.forEach(inline)}};e.childNodes.forEach(inline);flush();return}e.childNodes.forEach(walk);
 }
 document.querySelectorAll('#Main_Content_Val,#the_content .article_media_pic').forEach(e=>{if(!e.parentElement.closest('#Main_Content_Val,.article_media_pic'))walk(e)});
 const filtered=blocks.filter((b,i)=>b.type!=='image'||blocks[i-1]?.type!=='image'||b.src!==blocks[i-1].src||b.caption!==blocks[i-1].caption);
 const body=filtered.filter(b=>b.type!=='image').map(b=>b.text).join('\n');
 return{ready:body.length>0,locked,all:all?.url||'',next:next?.url||'',chapters,terminal:/[■□◆]\s*$/.test(body)||[...root.querySelectorAll('a.end_ico')].some(e=>!hidden(e)&&same({url:safe(e.getAttribute('href'))})),chars:body.length,data:{url:location.href,title:text(document,'h1')||document.title,meta:text(document,'#artInfo').replace(/(?:试听|听报道).*$/,''),description:text(document,'#subhead'),blocks:filtered}};
})()
