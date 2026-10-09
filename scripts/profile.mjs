import {Sessions} from '../lib/session.mjs';
import {ArticleFetcher} from '../lib/article-fetcher.mjs';
import {homedir} from 'node:os';
const sessions=await new Sessions(`${homedir()}/Library/Application Support/CaixinReader/v2`).init();
const fetcher=new ArticleFetcher(sessions);
try{for(const url of ['https://weekly.caixin.com/2026-08-21/102476335.html','https://weekly.caixin.com/2026-09-04/102481858.html','https://weekly.caixin.com/2026-08-21/102476335.html','https://weekly.caixin.com/2026-09-04/102481858.html']){const r=await fetcher.read(url,new AbortController().signal);console.log(JSON.stringify({url,access:r.access,path:r.path,elapsedMs:r.elapsedMs,timings:r.timings,blocks:r.blocks.length,images:r.blocks.filter(b=>b.type==='image').length,textHash:r.blocks.filter(b=>b.type!=='image').map(b=>b.text).join('\n').split('').reduce((h,ch)=>(Math.imul(h,31)+ch.charCodeAt(0))|0,0)}));}}finally{await sessions.resetBrowser()}
