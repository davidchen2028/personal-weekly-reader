import {mkdir,readFile,writeFile,rename,chmod} from 'node:fs/promises';
import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {chromium} from 'playwright';
const hash=s=>createHash('sha256').update(s).digest('hex');
const secret=()=>randomBytes(32).toString('hex');
export function equalSecret(a,b){return typeof a==='string'&&typeof b==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b))}
export function normalizeCookies(input,domainRoot="caixin.com"){
 if(!Array.isArray(input)||input.length>500)throw Error('请提供当前刊物的 Cookie 数组');
 return input.map(c=>{
 if(!c||typeof c!=='object')throw Error('Cookie 格式无效：条目必须是对象');
 const domain=String(c.domain||'').toLowerCase(),host=domain.replace(/^\./,'');
 if(!(host===domainRoot||host.endsWith('.'+domainRoot))||!/^[.a-z0-9-]+$/.test(domain))throw Error('Cookie 不属于当前刊物域名');
 // Chrome accepts unnamed cookies; preserve them when transferring its session.
 if(typeof c.name!=='string'||typeof c.value!=='string')throw Error('Cookie 格式无效：名称和值必须是字符串');
 if(/[\r\n\0]/.test(c.name+c.value))throw Error('Cookie 格式无效：包含非法控制字符');
 const result={name:c.name,value:c.value,domain:c.hostOnly?host:domain,path:c.path||'/',httpOnly:!!c.httpOnly,secure:!!c.secure};
 const ss={no_restriction:'None',unspecified:'Lax',lax:'Lax',strict:'Strict',None:'None',Lax:'Lax',Strict:'Strict'}[c.sameSite];if(ss)result.sameSite=ss;
 const expires=c.expirationDate??c.expires;if(expires>0)result.expires=expires;
 if(c.partitionKey){if(typeof c.partitionKey==='string')result.partitionKey=c.partitionKey;else {if(c.partitionKey.hasCrossSiteAncestor)throw Error('此分区 Cookie 暂不支持迁移，请联系开发者');result.partitionKey=c.partitionKey.topLevelSite}}
 return result;
 }).filter(c=>!c.expires||c.expires>Date.now()/1000);
}
export class Sessions{
 constructor(dir,domainRoot="caixin.com"){this.domainRoot=domainRoot;this.dir=dir;this.state={cookies:[],namespace:secret(),revision:0};this.pending=null;this.browser=null;this.context=null;this.lock=Promise.resolve();this.lastSync=0}
 async init(){await mkdir(this.dir,{recursive:true,mode:0o700});await chmod(this.dir,0o700);try{this.state=JSON.parse(await readFile(this.dir+'/session.json','utf8'))}catch{}return this}
 async save(){const p=this.dir+'/session.json';await writeFile(p+'.tmp',JSON.stringify(this.state),{mode:0o600});await chmod(p+'.tmp',0o600);await rename(p+'.tmp',p)}
 status(){return{paired:!!this.state.extensionId,hasSession:!!(this.state.cookies.length||this.state.authorization),cookieCount:this.state.cookies.length,hasToken:!!this.state.authorization,lastSync:this.state.syncedAt||null,revision:this.state.revision}}
 pairCode(){this.pending={code:randomBytes(5).toString('hex').toUpperCase(),expires:Date.now()+300000,attempts:0};return{code:this.pending.code,expires:this.pending.expires}}
 async pair(id,code){if(!/^[a-p]{32}$/.test(id))throw Error('扩展来源无效');if(!this.pending||this.pending.expires<Date.now()||++this.pending.attempts>8||!equalSecret(this.pending.code,String(code).trim().toUpperCase()))throw Error('配对码无效或已过期');this.pending=null;this.state={...this.state,extensionId:id,token:secret()};await this.save();return{token:this.state.token}}
 authorized(id,token){return id===this.state.extensionId&&equalSecret(token,this.state.token)}
 async sync(cookies,authorization){if(authorization!==undefined&&(this.domainRoot!=='cbnweek.com'||typeof authorization!=='string'||authorization.length>16384||/[\r\n\0]/.test(authorization)))throw Error('登录令牌格式无效');const auth=authorization??this.state.authorization??'';const normalized=normalizeCookies(cookies,this.domainRoot);const fingerprint=hash(auth+'|'+JSON.stringify([...normalized].sort((a,b)=>(a.domain+a.path+a.name).localeCompare(b.domain+b.path+b.name))));
 if(fingerprint!==this.state.fingerprint){await this.resetBrowser();this.state.cookies=normalized;this.state.authorization=auth;this.state.fingerprint=fingerprint;this.state.namespace=secret();this.state.revision++;}
 this.state.syncedAt=new Date().toISOString();await this.save();return this.status();}
 async contextFor(revision=this.state.revision){if(revision!==this.state.revision)throw Error('会话已更新，请重新读取');if(this.context)return this.context;if(this.opening)return this.opening;this.opening=(async()=>{const b=await chromium.launch({channel:'chrome',headless:true});if(revision!==this.state.revision){await b.close();throw Error('会话已更新')}this.browser=b;const ctx=await b.newContext({viewport:{width:1440,height:1000}});await ctx.addCookies(this.state.cookies);if(revision!==this.state.revision){await b.close();throw Error('会话已更新')}this.context=ctx;return ctx})();try{return await this.opening}finally{this.opening=null}}
 async resetBrowser(){this.context=null;if(this.browser){const b=this.browser;this.browser=null;await b.close()}if(this.opening)await this.opening.catch(()=>{});if(this.browser){await this.browser.close();this.browser=null;this.context=null}}
 async disconnect(){await this.resetBrowser();this.state={cookies:[],namespace:secret(),revision:this.state.revision+1};await this.save()}
 exclusive(fn){const p=this.lock.then(fn);this.lock=p.catch(()=>{});return p}
}
