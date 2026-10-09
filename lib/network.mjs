import {requestPacer} from './request-pacer.mjs';
import {lookup} from 'node:dns/promises';
import {safeURL} from '../parsers.mjs';
export async function checkedURL(raw,validator=safeURL){const url=validator(raw),host=new URL(url).hostname;const addresses=await lookup(host,{all:true});if(!addresses.length||addresses.some(({address:a})=>/^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|::ffff:|f[cd]|fe[89ab])/i.test(a)))throw Error('目标地址不可访问');return url}
async function rawRequest(ctx,url,{signal,referer,maxBytes=12*1024*1024,validator=safeURL,method="GET",headers:extraHeaders={},headerOrigin}={}){
 for(let i=0;i<5;i++){
  signal?.throwIfAborted();url=await checkedURL(url,validator);
  const outgoing={...(referer?{Referer:referer}:{}),...(!headerOrigin||new URL(url).origin===headerOrigin?extraHeaders:{})};
  let status,headers,body;
  if(ctx){const r=await ctx.request.fetch(url,{method,maxRedirects:0,timeout:12000,headers:outgoing});try{status=r.status();headers=r.headers();if(![301,302,303,307,308].includes(status)){if(Number(headers['content-length'])>maxBytes)throw Error('响应体过大');body=await r.body()}}finally{await r.dispose()}}
  else {const r=await fetch(url,{method,redirect:'manual',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(12000)]):AbortSignal.timeout(12000),headers:outgoing});status=r.status;headers=Object.fromEntries(r.headers);if(![301,302,303,307,308].includes(status)){const chunks=[];let size=0;for await(const chunk of r.body){size+=chunk.length;if(size>maxBytes)throw Error('响应体过大');chunks.push(chunk)}body=Buffer.concat(chunks)}else await r.body?.cancel();}
  if([301,302,303,307,308].includes(status)){if(!headers.location)throw Error('重定向缺少地址');url=new URL(headers.location,url).href;if(status===303||([301,302].includes(status)&&method==='POST'))method='GET';continue}
  if(status<200||status>=300)throw Object.assign(Error(`网站返回 ${status}`),{status,retryAfter:headers['retry-after']});if(body.length>maxBytes)throw Error('响应体过大');if(!body.length||(/text\/html/i.test(headers['content-type']||'')&&!body.toString('utf8').trim()))throw Object.assign(Error('官网返回空页面，已停止请求'),{code:'EMPTY_CONTENT'});signal?.throwIfAborted();return{body,headers,url};
 }
 throw Error('重定向次数过多');
}

export function request(ctx,url,options={}){
 const site=options.validator||safeURL;
 return requestPacer.run(site,()=>rawRequest(ctx,url,options),options.signal);
}
