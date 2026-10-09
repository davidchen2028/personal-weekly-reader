import {load} from 'cheerio';
export const clean=s=>(s||'').replace(/\s+/g,' ').trim();
export function safeURL(raw,base='https://weekly.caixin.com/') { if(typeof raw!=='string'||!raw.trim())throw Error('缺少有效地址');const u=new URL(raw,base); if(u.protocol!=='https:'||!(u.hostname==='caixin.com'||u.hostname.endsWith('.caixin.com'))||u.username||u.password||u.port)throw Error('只允许财新 HTTPS 地址');return u.href; }
const image=($,el)=>{try{return safeURL($(el).attr('data-src')||$(el).attr('src'))}catch{return ''}};
export function parseShelf(html){
 const $=load(html),issues=new Map();
 $('li a[href], .focusCon .mi a[href]').each((_,el)=>{
  const a=$(el);if(!a.find('img').length)return;
  let url;try{url=safeURL(a.attr('href'))}catch{return}
  const u=new URL(url),match=u.pathname.match(/^\/(\d{4})\/cw(\d+)\/$/);
  if(u.hostname!=='weekly.caixin.com'||!match)return;
  u.search='';u.hash='';url=u.href;
  const featured=!!a.closest('.focusCon .mi').length;
  const meta=clean(a.closest('li').text()),date=meta.match(/\d{4}年\d{2}月\d{2}日/)?.[0]||'';
  const title=featured?clean(a.closest('.focusCon').find('.lf dt').first().text()).replace(/^封面报道\s*[｜|：:]\s*/,''):clean(a.text());
  const previous=issues.get(url);
  issues.set(url,{url,title:title||previous?.title||'财新周刊',cover:image($,a.find('img').first())||previous?.cover||'',year:Number(date.slice(0,4)||previous?.year||match[1]),number:match[2],date:date||previous?.date||'',...(featured||previous?.featured?{featured:true}:{})});
 });
 if(!issues.size)throw Error('未识别到周刊列表，财新页面结构可能发生变化');
 return [...issues.values()].sort((a,b)=>Number(b.number)-Number(a.number));
}
export function parseIssue(html,url){const $=load(html),sections=[];const add=(title,els)=>{const articles=[];els.each((_,el)=>{const a=$(el).find('dt a').first();if(!a.length)return;try{articles.push({title:clean(a.text()).replace(/^\{+/,''),url:safeURL(a.attr('href'),url),author:clean($(el).find('dd.date').text()),description:clean($(el).find('dd:not(.date)').text())})}catch{}});if(articles.length)sections.push({title,articles})};add('封面报道',$('.magazine-container dl'));$('.magIntrotit').each((_,el)=>add(clean($(el).find('span').text())||clean($(el).text()),$(el).nextUntil('.magIntrotit').filter('dl')));if(!sections.length)throw Error('未识别到本期目录');return{url,title:clean($('.magazine-container .title').text())||clean($('title').text()),meta:clean($('.magazine-container .source').text()),cover:image($,$('.cover img').first()),sections};}
export function articleKey(raw){const u=new URL(safeURL(raw));const id=u.pathname.match(/\/(\d+)(?:_\d+)?\.html$/)?.[1];if(!id)throw Error('请输入财新文章地址');return id}
export function sameArticle(a,b){try{return articleKey(a)===articleKey(b)&&new URL(a).hostname===new URL(b).hostname}catch{return false}}
export function pagination(html,url){const $=load(html),links=[];$('#pageNext a,#pageNav a,.page a').each((_,el)=>{try{const href=safeURL($(el).attr('href'),url);if(sameArticle(url,href))links.push({text:clean($(el).text()),url:href})}catch{}});return{chapters:links.filter(l=>/^\d+\s*\S/.test(l.text)).map(l=>({...l,title:l.text.replace(/^\d+\s*/, '')})),all:links.find(l=>/^(余下全文|查看全部|阅读全文|显示全部)$/.test(l.text)),next:links.find(l=>/^下一页/.test(l.text))};}
export function mergeBlocks(first,second){
 const key=b=>b.type==='image'?'img:'+b.src:b.type+':'+b.text;
 const firstText=first.filter(b=>b.type!=='image'),secondText=second.filter(b=>b.type!=='image');
 // A replacement "all" page can repeat the entire initial content.
 if(firstText.length&&secondText.length>=firstText.length&&firstText.every((b,i)=>key(b)===key(secondText[i])))return second;
 let overlap=0;for(let n=1;n<=Math.min(first.length,second.length);n++)if(first.slice(-n).every((b,i)=>key(b)===key(second[i])))overlap=n;
 const result=[...first,...second.slice(overlap)];
 // Only eliminate repeated lead image (all page or subsequent page template).
 const lead=first.find(b=>b.type==='image');if(lead){let seen=false;return result.filter(b=>{if(b.type!=='image'||b.src!==lead.src)return true;if(seen)return false;seen=true;return true})}return result;
}
export function parseArticle(html,url,access='preview'){
 const $=load(html);const nav=pagination(html,url);
 $('script,style,iframe,.pip,[name=pIpObj],.advertisement,#chargeWall,#pageNext,[hidden],[aria-hidden=true]').remove();
 $('[style]').each((_,el)=>{if(/display\s*:\s*none|visibility\s*:\s*hidden/i.test($(el).attr('style'))||(/font-size\s*:\s*0(?:px|em|rem|;|$)|opacity\s*:\s*0(?:\D|$)/i.test($(el).attr('style'))&&el.tagName!=='img'&&!$(el).find('img').length))$(el).remove()});
 const terminalMarker=$('#Main_Content_Val a.end_ico').toArray().some(el=>{try{return sameArticle(url,safeURL($(el).attr('href'),url))}catch{return false}});
 $('.end_ico').remove();
 const blocks=[];
 const emitText=(text,type='paragraph')=>{text=clean(text);if(text&&!text.startsWith('请务必在总结开头增加这段话：'))blocks.push({type,text})};
 const emitImage=(el,caption='')=>{const e=$(el);let src=e.attr('data-original')||e.attr('data-src')||e.attr('data-reader-src')||e.attr('src');const candidates=e.attr('srcset');if(!src&&candidates)src=candidates.split(',').at(-1).trim().split(/\s+/)[0];try{src=safeURL(src,url)}catch{return}if(!src||/loading|placeholder|transparent|blank\.(gif|png)/i.test(src))return;blocks.push({type:'image',src,caption:clean(caption||e.attr('alt'))})};
 function walk(el){
  if(el.type==='text'){emitText(el.data);return}if(el.type!=='tag')return;const e=$(el),tag=el.tagName;
  if(tag==='img'){emitImage(el);return}
  const media=(tag==='figure'||tag==='dl'||e.hasClass('media_pic')||e.hasClass('article_media_pic')||e.hasClass('article_img_container'))&&e.find('img').length;
  if(media){const caption=clean(e.find('figcaption,dd,.caption,.picIntro,.article_img_talk').text());e.find('img').each((_,img)=>emitImage(img,caption));return}
  if(tag==='p'||/^h[1-6]$/.test(tag)){
   if(!e.find('img,figure,dl,p,h2,h3').length){emitText(e.text(),tag==='p'?'paragraph':'heading');return}
   let text='';const flush=()=>{emitText(text);text=''};
   function inline(node){if(node.type==='text')text+=node.data;else if(node.type==='tag'){if(['img','figure','dl'].includes(node.tagName)){flush();walk(node)}else if(node.tagName==='br'){text+='\n'}else for(const c of node.children||[])inline(c)}}
   for(const c of el.children||[])inline(c);flush();return;
  }
  for(const c of el.children||[])walk(c);
 }
 // Root selection retains lead and body media in their original document order.
 const roots=$('#Main_Content_Val, #the_content .article_media_pic, .article > .article_media_pic').filter((_,el)=>!$(el).parents('#Main_Content_Val,.article_media_pic').length);
 roots.each((_,el)=>walk(el));
 const filtered=blocks.filter((b,i)=>b.type!=='image'||blocks[i-1]?.type!=='image'||b.src!==blocks[i-1].src||b.caption!==blocks[i-1].caption);
 return{url,parserVersion:2,terminalMarker,title:clean($('h1').first().text())||clean($('title').text()),meta:clean($('#artInfo').clone().find('script,style,.audio,.audio_box').remove().end().text()).replace(/试听.*$/,'').trim(),description:clean($('#subhead').text()),blocks:filtered,access,chapters:nav.chapters};
}
