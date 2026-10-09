import {load} from 'cheerio';
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {request} from '../lib/network.mjs';
import {digest} from '../lib/cache.mjs';
const ROOT='https://www.eeo.com.cn/epaper/eeocover/1.shtml';
const HOSTS=new Set(['www.eeo.com.cn','epaper.eeo.com.cn','api.eeo.com.cn','app.eeo.com.cn','img.eeo.com.cn','upload.eeo.com.cn']);
const clean=s=>String(s||'').replace(/\s+/g,' ').trim();
export function eeoURL(raw,base=ROOT){const u=new URL(raw,base);if(u.protocol==='http:'&&HOSTS.has(u.hostname))u.protocol='https:';if(u.protocol!=='https:'||!HOSTS.has(u.hostname)||u.port||u.username||u.password)throw Error('只允许经济观察报官方 HTTPS 地址');return u.href}
export function eeoRef(raw){const u=new URL(eeoURL(raw));if(u.hostname!=='epaper.eeo.com.cn'||u.pathname!=='/epaper/index.html'||!/^\d+$/.test(u.searchParams.get('qid')||''))throw Error('经济观察报期号无效');const id=u.searchParams.get('article');if(id&&!/^[\w.-]{1,160}$/.test(id))throw Error('经济观察报文章标识无效');return{qid:u.searchParams.get('qid'),id}}
export const issueURL=qid=>`https://epaper.eeo.com.cn/epaper/index.html?qid=${qid}`;
export function parseEeoShelf(html,url=ROOT){const $=load(html),issues=[];$('.dzkw_dzb_box').each((_,el)=>{const e=$(el),qid=e.find('input[id^=e_cid_]').val(),date=e.find('input[id^=e_cbqh_]').val();if(!/^\d+$/.test(qid||'')||!/^\d{4}-\d{2}-\d{2}$/.test(date||''))return;let cover='';try{cover=eeoURL(e.find('.dzkw_dzb_box_l img').attr('src'),url)}catch{}issues.push({id:qid,url:issueURL(qid),title:'经济观察报',number:qid,date,year:Number(date.slice(0,4)),cover})});if(!issues.length)throw Error('未识别到经济观察报期刊列表');let next='';const href=$('.wzlist_page a.next').attr('href');if(href&&!href.startsWith('javascript:')){next=eeoURL(href,url);if(!/^https:\/\/www\.eeo\.com\.cn\/epaper\/eeocover\/\d+\.shtml$/.test(next))throw Error('列表分页地址异常')}return{issues,next}}
export function parseEeoIssue(response,qid,{verified=false}={}){
 if(response.usertype===1)throw Object.assign(Error('经济观察报要求重新登录'),{access:'restricted'});
 if(response.usertype===3)throw Object.assign(Error('当前账号未获本期电子报订阅权限'),{access:'issue_restricted'});
 if(response.state!==true||!Array.isArray(response.data?.list))throw Error('经济观察报响应结构异常');
 const d=response.data;if(d.edition_number&&String(d.edition_number)!==String(qid))throw Error('返回期号与请求不符');
 const articles={},sections=[],seen=new Map();
 for(const [pi,p] of d.list.entries()){if(!Array.isArray(p.article_list))throw Error('版面目录结构异常');const entries=[];for(const [ai,a] of p.article_list.entries()){
 const signature=digest(JSON.stringify([a.title,a.authorName,a.content,a.imagesname,a.uri]));let id=a.id!=null?String(a.id):'legacy-'+digest(`${p.version_number}|${a.title}|${a.authorName}|${ai}`).slice(0,24);if(!/^[\w.-]{1,120}$/.test(id))id=digest(id);if(seen.has(id)&&seen.get(id)!==signature)id+='-'+String(p.version_number||pi)+'-'+ai;seen.set(id,signature);
 let invalidMedia=false;const blocks=[],media=new Set();const addImage=src=>{try{src=eeoURL(src,issueURL(qid));if(!media.has(src)){media.add(src);blocks.push({type:'image',src,caption:''})}}catch{invalidMedia=true}};
 for(const name of String(a.imagesname||'').split(',').map(s=>s.trim()).filter(Boolean))addImage(String(a.uri||'').replace(/\/$/,'')+'/'+name);
 const $=load(String(a.content||'').replace(/\r\n?/g,'\n'));$('script,style,iframe,form,object,embed').remove();
 function walk(n){if(n.type==='text'){for(const line of n.data.split('\n')){const text=clean(line);if(text)blocks.push({type:'paragraph',text})}}else if(n.type==='tag'){if(n.name==='img')addImage($(n).attr('src'));else if(/^h[1-6]$/.test(n.name))blocks.push({type:'heading',text:clean($(n).text())});else if(n.name==='p'&&!$(n).find('img,br').length){const text=clean($(n).text());if(text)blocks.push({type:'paragraph',text})}else for(const c of n.children||[])walk(c)}}
 for(const n of $('body').contents().toArray())walk(n);const first=blocks.findIndex(b=>b.type!=='image');if(first>=0&&blocks[first].text===clean(a.authorName))blocks.splice(first,1);
 const url=issueURL(qid)+'&article='+encodeURIComponent(id);const data={provider:'eeo',id,issueId:String(qid),url,sourceUrl:issueURL(qid),title:clean(a.title),meta:[a.publishTime,`第${a.number||p.version_number}版`,a.authorName].filter(Boolean).join(' · '),description:'',blocks,access:verified&&blocks.length&&!invalidMedia?'complete':'unverified',reason:verified&&blocks.length&&!invalidMedia?'已核对官网整期数据与正文':'内容可读，授权或完整性待核验',fetchedAt:new Date().toISOString(),contentHash:signature};articles[id]=data;entries.push({title:data.title,url,author:clean(a.authorName),description:'',id})}
 sections.push({title:`第${String(p.version_number||pi+1).padStart(2,'0')}版 ${clean(p.article_type)}`,articles:entries})}
 if(!sections.length)throw Error('本期目录为空');return{url:issueURL(qid),id:String(qid),title:`《经济观察报》第${qid}期`,meta:clean(d.date),cover:'',sections,articles};
}
export class EeoProvider{
 constructor(sessions,dir){this.sessions=sessions;this.dir=dir;this.snapshots=new Map();this.pending=new Map();this.discovery=null;this.catalog={issues:[],next:ROOT,complete:false};this.apiBase=null}
 async init(){await mkdir(this.dir,{recursive:true,mode:0o700});try{this.catalog=JSON.parse(await readFile(this.dir+'/discovery.json','utf8'))}catch{}return this}
 async save(){const p=this.dir+'/discovery.json';await writeFile(p+'.tmp',JSON.stringify(this.catalog),{mode:0o600});await rename(p+'.tmp',p)}
 async http(url,options={}){return request(null,url,{...options,validator:eeoURL,maxBytes:24*1024*1024})}
 async shelf(signal){if(this.discovery)return this.discovery;this.discovery=this.discover(signal).finally(()=>this.discovery=null);return this.discovery}
 async discover(signal){let cursor=ROOT;const seen=new Set(),all=new Map(this.catalog.issues.map(i=>[i.id,i]));let stable=0;while(cursor){signal?.throwIfAborted();if(seen.has(cursor)||seen.size>=500)throw Error('期刊发现未完成：分页循环或超出安全上限');seen.add(cursor);const page=parseEeoShelf((await this.http(cursor,{signal})).body.toString('utf8'),cursor);const known=page.issues.every(i=>all.has(i.id));for(const i of page.issues)all.set(i.id,i);this.catalog.issues=[...all.values()].sort((a,b)=>b.date.localeCompare(a.date));if(this.catalog.complete){stable=known?stable+1:0;if(stable>=2)break;cursor=page.next}else{const resume=this.catalog.next;cursor=cursor===ROOT&&resume&&resume!==ROOT?resume:page.next;this.catalog.next=cursor;if(!cursor)this.catalog.complete=true}await this.save()}await this.save();return this.catalog.issues}
 async issue(url,signal,force=false){const {qid}=eeoRef(url),revision=this.sessions.state.revision,key=revision+'|'+qid;if(force)this.snapshots.delete(key);if(this.snapshots.has(key))return this.snapshots.get(key);if(this.pending.has(key))return this.pending.get(key);const task=this.fetchIssue(qid,signal,revision).then(d=>{if(this.sessions.state.revision!==revision)throw Error('经济观察报会话已更新');this.snapshots.set(key,d);if(this.snapshots.size>8)this.snapshots.delete(this.snapshots.keys().next().value);return d}).finally(()=>this.pending.delete(key));this.pending.set(key,task);return task}
 async fetchIssue(qid,signal,revision){if(!this.sessions.state.cookies.length)throw Object.assign(Error('请在 Chrome 登录经济观察报，并同步该刊登录态'),{access:'restricted'});
 if(!this.apiBase){const js=(await this.http('https://epaper.eeo.com.cn/epaper/js/index.js',{signal})).body.toString('utf8');const match=js.match(/\$\.get\("(https:\/\/api\.eeo\.com\.cn\/[^"\n]+action=getEpaper[^"\n]+qid=)"/);if(!match)throw Error('官网接口已变化，请更新适配器');this.apiBase=eeoURL(match[1])}
 const ctx=await this.sessions.contextFor(revision);let payload;try{payload=JSON.parse((await request(ctx,this.apiBase+qid,{validator:eeoURL,referer:issueURL(qid),signal,maxBytes:24*1024*1024})).body.toString('utf8'))}catch(e){throw e}
 const provisional=parseEeoIssue(payload,qid); // Never ignore explicit login / subscription responses.
 let verified=payload.usertype===2;
 if(!verified){const page=await ctx.newPage();const abort=()=>page.close().catch(()=>{});signal?.addEventListener('abort',abort,{once:true});try{await page.goto(issueURL(qid),{waitUntil:'domcontentloaded',timeout:20000});await page.locator('.read_body_text').waitFor({timeout:12000});const text=await page.locator('.read_body_text').innerText();const first=Object.values(provisional.articles)[0];const expected=first?.blocks.filter(b=>b.type!=='image').map(b=>b.text).join('');verified=!!expected&&text.replace(/\s/g,'').includes(expected.replace(/\s/g,''))}catch{verified=false}finally{signal?.removeEventListener('abort',abort);await page.close().catch(()=>{})}}
 signal?.throwIfAborted();return parseEeoIssue(payload,qid,{verified})}
 async read(url,signal,progress=()=>{},force=false){const {qid,id}=eeoRef(url);if(!id)throw Error('请选择本期目录中的文章');progress('正在读取经济观察报整期数据');const d=await this.issue(issueURL(qid),signal,force);const a=d.articles[id];if(!a)throw Error('本期未找到该文章，请刷新目录');return a}
}
