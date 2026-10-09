// Shared by both publications; foreground jobs are selected ahead of queued downloads.
export class ReadSlots{
 constructor(limit=2){this.limit=limit;this.active=0;this.queue=[]}
 async run(fn,signal,priority=0){signal?.throwIfAborted();await new Promise((resolve,reject)=>{const item={resolve,reject,priority,signal};const cancel=()=>{this.queue=this.queue.filter(x=>x!==item);reject(signal.reason||Error('已取消'))};item.start=()=>{signal?.removeEventListener('abort',cancel);this.active++;resolve()};signal?.addEventListener('abort',cancel,{once:true});this.queue.push(item);this.drain()});try{signal?.throwIfAborted();return await fn()}finally{this.active--;this.drain()}}
 drain(){this.queue.sort((a,b)=>a.priority-b.priority);while(this.active<this.limit&&this.queue.length)this.queue.shift().start()}
}
export const readSlots=new ReadSlots();
