import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
export class SiteBudget{
 constructor(dir,{now=Date.now}={}){this.dir=dir;this.now=now;this.state={blockedUntil:0};}
 async init(){await mkdir(this.dir,{recursive:true});try{this.state=JSON.parse(await readFile(this.dir+'/request-budget.json','utf8'))}catch{}if('attempts' in this.state){delete this.state.attempts;await this.save()}return this}
 async save(){await writeFile(this.dir+'/request-budget.tmp',JSON.stringify(this.state),{mode:0o600});await rename(this.dir+'/request-budget.tmp',this.dir+'/request-budget.json')}
 error(until,reason){return Object.assign(Error(reason+'，请在 '+new Date(until).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})+' 后手动继续'),{code:'SITE_COOLDOWN',until})}
 async before(){if(this.state.blockedUntil>this.now())throw this.error(this.state.blockedUntil,this.state.reason||'财经站点冷却中')}
 async failed(error){if(![403,429].includes(error.status)&&error.code!=='EMPTY_CONTENT')return;const retry=Number(error.retryAfter);const until=Number.isFinite(retry)?this.now()+Math.max(0,retry)*1000:Date.parse(error.retryAfter)||0;this.state.blockedUntil=Math.max(this.now()+6*3600000,until);this.state.reason=error.code==='EMPTY_CONTENT'?'财经返回空页面或空正文':`财经返回 ${error.status}`;await this.save()}
}
