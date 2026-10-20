import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
export class ReadingState{
 constructor(dir){this.dir=dir;this.items={};this.queue=Promise.resolve()}
 async init(){await mkdir(this.dir,{recursive:true});try{this.items=JSON.parse(await readFile(this.dir+'/reading-state.json','utf8'))}catch(error){if(error.code!=='ENOENT')throw error}return this}
 has(url){return Object.hasOwn(this.items,url)}
 set(url,finished){const task=this.queue.then(async()=>{const next={...this.items};if(finished)next[url]={finishedAt:new Date().toISOString()};else delete next[url];await writeFile(this.dir+'/reading-state.tmp',JSON.stringify(next),{mode:0o600});await rename(this.dir+'/reading-state.tmp',this.dir+'/reading-state.json');this.items=next;return{url,finished:this.has(url)}});this.queue=task.catch(()=>{});return task}
}
