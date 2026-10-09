import {setTimeout as delay} from 'node:timers/promises';
// Shared by a publication's HTML, API and image requests. Cache hits never enter here.
export class RequestPacer {
 constructor({gap=2000,maxDelay=60000,now=Date.now,sleep=(ms,signal)=>delay(ms,undefined,{signal})}={}){Object.assign(this,{gap,maxDelay,now,sleep});this.sites=new Map()}
 async run(site,operation,signal){
  let state=this.sites.get(site);if(!state){state={tail:Promise.resolve(),next:0,failures:0};this.sites.set(site,state)}
  const previous=state.tail;let release;state.tail=new Promise(r=>release=r);
  try{
   await previous;signal?.throwIfAborted();
   const wait=state.next-this.now();if(wait>0)await this.sleep(wait,signal);
   signal?.throwIfAborted();
   try{const result=await operation();state.failures=0;state.next=this.now()+this.gap;return result}
   catch(error){if(!signal?.aborted){state.failures++;state.next=this.now()+Math.min(this.maxDelay,this.gap*2**Math.min(state.failures,10))}throw error}
  }finally{release()}
 }
}
export const requestPacer=new RequestPacer();
