import {test} from 'node:test';
import assert from 'node:assert/strict';
import {safeURL,parseShelf,parseIssue,parseArticle} from '../parsers.mjs';
test('URL 限制：拒绝域名伪装、脚本和非 HTTPS',()=>{for(const url of ['https://caixin.com.evil.test/x','http://weekly.caixin.com/','javascript:alert(1)','https://evil.test/','https://u:p@caixin.com/'])assert.throws(()=>safeURL(url));assert.equal(safeURL('//weekly.caixin.com/'),'https://weekly.caixin.com/')});
test('书架去重与懒加载封面',()=>{const item='<li><a href="https://weekly.caixin.com/2026/cw1222/"><img data-src="//img.caixin.com/cover.jpg">标题</a>2026年09月07日出版</li>';const a=parseShelf(item+item);assert.equal(a.length,1);assert.equal(a[0].number,'1222');assert.equal(a[0].cover,'https://img.caixin.com/cover.jpg')});
test('正文不包含脚本或侧栏，预览不会标为全文',()=>{const a=parseArticle('<h1>标题</h1><div id="Main_Content_Val"><p>正文<script>danger()</script></p><div hidden><p>隐藏</p></div><div class="pip"><p>广告</p></div></div>','https://weekly.caixin.com/a');assert.equal(a.access,'preview');assert.deepEqual(a.blocks,[{type:'paragraph',text:'正文'}])});
test('栏目与作者分离',()=>{const a=parseIssue('<div class="magIntrotit"><span>金融</span>Finance</div><dl><dt><a href="https://weekly.caixin.com/2026-09-05/1.html">文章</a></dt><dd class="date">作者</dd><dd>简介</dd></dl>','https://weekly.caixin.com/');assert.equal(a.sections[0].title,'金融');assert.equal(a.sections[0].articles[0].description,'简介')});

test('出版年份优先于跨年目录地址',()=>{const a=parseShelf('<li><a href="https://weekly.caixin.com/2025/cw1188/"><img src="https://img.caixin.com/a.jpg">标题</a>2026年01月05日出版</li>');assert.equal(a[0].year,2026)});

test('最新封面进入书架，排除订阅按钮，并与往期去重',()=>{
 const hero='<div class="focusCon"><div class="lf"><dt><a href="/2026-09-24/102488599.html">封面报道｜汽车大整合“破冰”</a></dt><a href="https://mall.caixin.com/">现在订阅</a></div><div class="mi"><a href="https://weekly.caixin.com/2026/cw1225/"><img src="https://img.caixin.com/latest.jpg"></a></div></div>';
 const old='<li><a href="/2026/cw1224/"><img src="https://img.caixin.com/old.jpg">济州岛迷雾</a>2026年09月21日出版</li>';
 const list=parseShelf(hero+old);assert.equal(list.length,2);assert.equal(list[0].number,'1225');assert.equal(list[0].title,'汽车大整合“破冰”');assert.equal(list[0].featured,true);assert.equal(list[0].url,'https://weekly.caixin.com/2026/cw1225/');assert.equal(parseShelf(hero).length,1);
 const duplicate='<li><a href="/2026/cw1225/"><img src="https://img.caixin.com/latest.jpg">汽车大整合“破冰”</a>2026年09月28日出版</li>';
 const merged=parseShelf(hero+old+duplicate);assert.equal(merged.length,2);assert.equal(merged[0].date,'2026年09月28日');assert.equal(merged[0].featured,true);
});
