/* Pure parsers: remote markup is parsed in an inert document, never inserted as HTML. */
window.parsePublication=(provider,mode,url,payload)=>{
 const clean=s=>String(s||'').replace(/\s+/g,' ').trim(),doc=s=>new DOMParser().parseFromString(s||'','text/html');
 const text=(d,s)=>clean(d.querySelector(s)?.textContent);
 const safe=s=>{const u=new URL(s,url);if(u.protocol==='http:'&&u.hostname.endsWith('.eeo.com.cn'))u.protocol='https:';if(u.protocol!=='https:'||u.username||u.password||u.port)throw Error('图片地址不支持');const hosts={eeo:['www.eeo.com.cn','epaper.eeo.com.cn','api.eeo.com.cn','app.eeo.com.cn','img.eeo.com.cn','upload.eeo.com.cn'],caijing:['www.mycaijing.com','res.caijingmobile.com'],cbnweek:['www.cbnweek.com','api.cbnweek.com','imgcdn.cbnweek.com','imgcdn.yicai.com']}[provider];if(!hosts.includes(u.hostname))throw Error('非本站资源');return u.href};
 function blocks(html,lead=[]){const d=doc(html),out=[],seen=new Set();let invalid=false;
 const image=(src,caption='')=>{try{src=safe(src);if(!seen.has(src)){seen.add(src);out.push({type:'image',src,caption:clean(caption)})}}catch{invalid=true}};
 lead.filter(Boolean).forEach(src=>image(src));d.querySelectorAll('script,style,iframe,form,object,embed,[hidden]').forEach(e=>e.remove());
 const walk=n=>{if(n.nodeType===3){for(const line of n.textContent.split('\n'))if(clean(line))out.push({type:'paragraph',text:clean(line)});return}if(n.nodeType!==1)return;if(/display\s*:\s*none|visibility\s*:\s*hidden/.test(n.getAttribute('style')||''))return;
 if(n.tagName==='IMG'){image(n.getAttribute('data-original')||n.getAttribute('data-src')||n.getAttribute('src'),n.alt);return}
 if(n.tagName==='FIGURE'){n.querySelectorAll('img').forEach(e=>image(e.getAttribute('data-src')||e.getAttribute('src'),text(n,'figcaption')));return}
 if((n.tagName==='P'||/^H[1-6]$/.test(n.tagName))&&!n.querySelector('img,br')){if(clean(n.textContent))out.push({type:n.tagName==='P'?'paragraph':'heading',text:clean(n.textContent)});return}n.childNodes.forEach(walk)};
 d.body.childNodes.forEach(walk);return {blocks:out,invalid};
 }
 if(provider==='cbnweek'){
 if(mode==='shelf'){const issues=payload.flatMap(g=>g.data||[]).filter(i=>['Magazine','Subject'].includes(i.type)).map(i=>({url:'https://www.cbnweek.com/'+(i.type==='Magazine'?'magalog/':'read_detail/')+i.id,title:i.summary||i.name,cover:safe(i.cover_url),date:String(i.display_time||i.publish_at||'').slice(0,10),year:Number(i.maga_year||String(i.display_time||i.publish_at).slice(0,4)),number:String(i.maga_all_number||''),issueType:i.type==='Subject'?1:0}));return{issues:issues.sort((a,b)=>b.date.localeCompare(a.date))}}
 if(mode==='issue'){const info=payload.info,groups=payload.groups;const sections=groups.map(g=>({title:g.column_name||'单行本目录',articles:(g.articles||[]).map(a=>({title:a.title,url:'https://www.cbnweek.com/article_detail/'+a.id,description:a.summary||''}))}));if(!sections.length||!sections.some(s=>s.articles.length))throw Error('目录为空');return{title:info.summary||info.name,meta:info.name,cover:safe(info.cover_url),sections}}
 const d=payload,b=blocks(d.content,[d.cover_url]),length=b.blocks.reduce((n,x)=>n+(x.text?.length||0),0),allowed=d.is_jurisdiction===true||d.is_jurisdiction===1;
 return{title:d.title,description:d.summary,meta:String(d.display_time||'').slice(0,10)+' · '+(d.authors||[]).map(a=>a.name).join('、'),blocks:b.blocks,access:!allowed?'restricted':!b.invalid&&length>0&&(!d.word_times||length>=d.word_times*.85)?'complete':'unverified',reason:allowed?'已核对官网授权正文与题图':'请登录并确认订阅权限'};
 }
 if(provider==='caijing'){
 if(mode==='shelf'){const issues=payload.flatMap(x=>x.items.map(i=>({url:'https://www.mycaijing.com/issue/detail/'+i.id,title:i.title||i.name,cover:i.coverImagePath?safe(i.coverImagePath):'',date:/^\d{2}-\d{2}$/.test(i.issueDate||'')?(i.year||x.year)+'-'+i.issueDate:String(i.saleTime||'').slice(0,10),year:Number(i.year||x.year),number:String(i.totalIssueNumber||''),issueType:x.type})));return{issues:issues.sort((a,b)=>b.date.localeCompare(a.date))}}
 const d=doc(payload);
 if(mode==='issue'){const sections=[...d.querySelectorAll('.list-block.media-list')].map(e=>({title:clean(e.previousElementSibling?.textContent)||'本期文章',articles:[...e.querySelectorAll('a[href*="/article/detail/"]')].map(a=>{a.querySelector('.canRead')?.remove();return{title:text(a,'.item-title'),url:safe(a.getAttribute('href')),description:text(a,'.item-text')}})})).filter(s=>s.articles.length);if(!sections.length)throw Error('未找到目录');return{title:text(d,'.issue-title'),meta:text(d,'.issue-desc'),cover:safe(d.querySelector('.issueCoverImage img')?.getAttribute('src')),sections}}
 const b=blocks(d.querySelector('.article-content')?.innerHTML),length=b.blocks.reduce((n,x)=>n+(x.text?.length||0),0),expected=Number(text(d,'.subtitle').match(/本文\s*(\d+)\s*字/)?.[1]||0),locked=!!d.querySelector('.order-info');
 return{title:text(d,'.article-title'),meta:text(d,'.subtitle')+' · '+text(d,'.article-time'),description:text(d,'.article-desc'),blocks:b.blocks,access:locked?'restricted':length&&!b.invalid&&(!expected||length>=expected*.85)?'complete':'unverified',reason:locked?'请登录并确认本文订阅权限':'已核对正文篇幅及配图'};
 }
 if(mode==='shelf'){const d=doc(payload),issues=[...d.querySelectorAll('.dzkw_dzb_box')].map(e=>{const id=e.querySelector('input[id^=e_cid_]')?.value,date=e.querySelector('input[id^=e_cbqh_]')?.value;return{url:'https://epaper.eeo.com.cn/epaper/index.html?qid='+id,title:'经济观察报',number:id,date,year:Number(date?.slice(0,4)),cover:safe(e.querySelector('.dzkw_dzb_box_l img')?.getAttribute('src'))}}).filter(i=>/^\d+$/.test(i.number));return{issues,next:d.querySelector('.wzlist_page a.next')?.getAttribute('href')||''}}
 if(payload.usertype===1||payload.usertype===3)throw Error('经济观察报要求登录或本期订阅权限');
 if(payload.state!==true||!Array.isArray(payload.data?.list))throw Error('目录响应异常');
 const qid=new URL(url).searchParams.get('qid'),articles={},sections=payload.data.list.map((p,pi)=>({title:'第'+p.version_number+'版 '+(p.article_type||''),articles:(p.article_list||[]).map((a,ai)=>{
 const id=String(a.id??('legacy-'+pi+'-'+ai))+'-'+pi+'-'+ai,articleURL='https://epaper.eeo.com.cn/epaper/index.html?qid='+qid+'&article='+encodeURIComponent(id),lead=String(a.imagesname||'').split(',').filter(Boolean).map(n=>String(a.uri||'').replace(/\/$/,'')+'/'+n),b=blocks(a.content,lead);
 articles[id]={title:a.title,meta:[a.publishTime,p.version_number,a.authorName].filter(Boolean).join(' · '),blocks:b.blocks,access:payload.usertype===2&&b.blocks.length&&!b.invalid?'complete':'unverified',reason:'官网整期正文',url:articleURL,sourceUrl:'https://epaper.eeo.com.cn/epaper/index.html?qid='+qid};return{title:a.title,url:articleURL,author:a.authorName};
 })}));
 if(mode==='article'){const id=new URL(url).searchParams.get('article');if(!articles[id])throw Error('文章未找到，请刷新目录');return articles[id]}
 return{title:'《经济观察报》第'+qid+'期',sections,articles};
};
