import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
export const ISSUE_LIMIT=100;
export function recentIssues(issues){const stamp=i=>Date.parse(String(i.date||'').replace(/年|月/g,'-').replace('日',''))||Number(i.year||0)*366*86400000;return [...new Map(issues.map(i=>[i.url,i])).values()].sort((a,b)=>stamp(b)-stamp(a)).slice(0,ISSUE_LIMIT)}
export const SYNC_INTERVAL=null;
// One worker, persisted status, dependency injection for deterministic tests.
export class LibrarySync{
 constructor({dir,session,shelf,issue,article,image,completed,commit,interval=SYNC_INTERVAL}){Object.assign(this,{dir,session,shelf,issue,article,image,completed,commit,interval});this.state={enabled:true,state:'idle',lastCheck:null,nextCheck:null};this.catalog={issues:[],details:{}};this.task=null;this.closed=false;this.saveQueue=Promise.resolve()}
 async init(){await mkdir(this.dir,{recursive:true,mode:0o700});for(const [file,key] of [['status','state'],['catalog','catalog']])try{this[key]=JSON.parse(await readFile(`${this.dir}/${file}.json`,'utf8'))}catch{}if(this.state.state==='running')this.state.state='interrupted';this.state.nextCheck=null;this.state.enabled=false;return this}
 async save(file,value){const raw=JSON.stringify(value);this.saveQueue=this.saveQueue.catch(()=>{}).then(async()=>{await writeFile(`${this.dir}/${file}.tmp`,raw,{mode:0o600});await rename(`${this.dir}/${file}.tmp`,`${this.dir}/${file}.json`)});return this.saveQueue}
 status(){return {...this.state,running:!!this.task,issueCount:recentIssues(this.catalog.issues).length,issueLimit:ISSUE_LIMIT}}
 startTimer(){}
 tick(){}
 start(manual=true){if(this.task)return this.status();if(manual)this.state.enabled=true;if(!this.session().hasSession){this.state.state='waiting';this.state.message='请先连接账号，再手动开始缓存';this.save('status',this.state);return this.status()}this.controller=new AbortController();this.state={...this.state,state:'running',startedAt:Date.now(),finishedAt:null,current:'检查周刊列表',issuesDone:0,articlesDone:0,articlesTotal:0,imagesDone:0,skipped:0,errors:[],errorCount:0,message:''};this.task=this.run(this.controller.signal).catch(e=>{if(!this.blocked(e)){this.state.state=this.controller.signal.aborted?'paused':'error';this.state.message=e.message}}).finally(async()=>{this.state.finishedAt=Date.now();await this.save('status',this.state);this.task=null});return this.status()}
 blocked(e){
  let reason='';
  if(e.code==='EMPTY_CONTENT')reason='官网返回空页面或空正文，可能是服务异常或访问限制';
  else if(e.status===429||/网站返回 429/.test(e.message))reason='官网限制请求频率（429）';
  else if(e.status===403||/网站返回 403/.test(e.message))reason='官网拒绝访问（403）';
  else if(e.access==='restricted'||e.status===401)reason='官网要求检查登录或订阅权限';
  if(!reason)return false;
  this.state.nextCheck=null;this.state.enabled=false;this.state.state='blocked';
  this.state.message=reason+'，已暂停该刊下载；不会自动重试，请确认官网恢复后手动继续';return true;
 }
 async run(signal){const owner=this.session();const check=()=>{signal.throwIfAborted();if(this.session().namespace!==owner.namespace||this.session().revision!==owner.revision)throw Error('登录会话已变化，下一次检查将重新核对存档')};const error=(url,e)=>{this.state.errorCount++;this.state.errors.push({url,message:e.message});this.state.errors=this.state.errors.slice(-30)};
  check();const issues=await this.shelf(signal);check();this.queue=recentIssues(issues);this.selectedUrls=new Set(this.queue.map(i=>i.url));this.catalog.issues=issues;await this.save('catalog',this.catalog);this.state.lastCheck=Date.now();this.state.nextCheck=null;
  const seen=new Set();for(const magazine of this.queue){check();if(!this.selectedUrls.has(magazine.url))continue;this.currentMagazine=magazine.url;this.state.current=magazine.title||magazine.url;let detail=this.catalog.details[magazine.url];try{if(!detail){detail=await this.issue(magazine.url,signal);check();this.catalog.details[magazine.url]=detail;await this.save('catalog',this.catalog)}
    for(const cover of new Set([magazine.cover,detail.cover].filter(Boolean)))try{await this.image(cover,magazine.url,owner,signal);check()}catch(e){check();error(cover,e);if(this.blocked(e))return}
    const articles=detail.sections.flatMap(s=>s.articles);for(const entry of articles){if(seen.has(entry.url))continue;seen.add(entry.url);this.state.articlesTotal++;check();this.state.current=entry.title||entry.url;try{if(this.completed&&await this.completed(entry.url,owner)){check();this.state.skipped++;this.state.articlesDone++;continue}const data=await this.article(entry.url,owner,signal);check();if(!data?.blocks?.length)throw Object.assign(Error('官网返回空正文'),{code:'EMPTY_CONTENT'});if(data.cacheHit)this.state.skipped++;for(const block of data.blocks.filter(b=>b.type==='image')){await this.image(block.src,entry.url,owner,signal);check();this.state.imagesDone++}if(data.access!=='complete')throw Error(data.reason||'正文未核实完整，已保存当前可见内容');if(this.commit&&await this.commit(entry.url,owner,data)===false)throw Error('正文或图片未完整落盘，稍后重试');this.state.articlesDone++}catch(e){check();error(entry.url,e);if(this.blocked(e))return}await this.save('status',this.state);}
   }catch(e){check();error(magazine.url,e);if(this.blocked(e))return}this.state.issuesDone++;await this.save('status',this.state)}
  this.state.state=this.state.errorCount?'partial':'done';this.state.message=this.state.errorCount?'本轮结束，部分项目失败，手动再次缓存时重试':'最近100期内的周刊缓存完成';
 }
 async pause(){this.state.enabled=false;this.controller?.abort(Error('已暂停缓存'));await this.task;this.state.state='paused';this.state.message='已暂停；点击缓存最近100期可手动继续';await this.save('status',this.state)}
 changed(){this.controller?.abort(Error('登录会话已变化'));if(this.state.enabled)this.state.nextCheck=null}
 async close(){this.closed=true;clearInterval(this.timer);const interrupted=!!this.task;this.controller?.abort(Error('服务已停止'));await this.task;await this.discovery;if(interrupted&&this.state.enabled){this.state.state='interrupted';await this.save('status',this.state)}await this.saveQueue.catch(()=>{})}
}
