package local.caixin.reader;

import android.app.*;
import android.os.*;
import android.content.*;
import android.content.res.Configuration;
import android.graphics.Color;
import android.net.Uri;
import android.view.*;
import android.webkit.*;
import android.webkit.CookieManager;
import android.widget.*;
import org.json.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.*;

/** No JavaScript bridge is installed on the remote Caixin WebView. */
public class MainActivity extends Activity {
 private static final String ORIGIN="https://reader.local/";
 private final Handler ui=new Handler(Looper.getMainLooper());
 private final ExecutorService disk=Executors.newSingleThreadExecutor();
 private final ExecutorService network=Executors.newFixedThreadPool(2);
 private PublicationClient publications;
 private WebView reader,source; private FrameLayout frame; private LinearLayout loginBar;
 private SharedPreferences prefs; private String extractor,mode="",requested="",namespace="",requestId="";
 private int generation=0,pages=0,stable=0,lastChars=0;private boolean loading=false,login=false,expanded=false;
 private long began,pageBegan; private JSONObject combined; private JSONArray expected=new JSONArray();
 private final Set<String> visited=new HashSet<>();
 private final ConcurrentHashMap<String,String> assets=new ConcurrentHashMap<>();
 private final ConcurrentHashMap<String,String> referers=new ConcurrentHashMap<>();
 private File store;
 @Override public void onCreate(Bundle state){super.onCreate(state);WebView.setWebContentsDebuggingEnabled((getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE)!=0);prefs=getSharedPreferences("reader",MODE_PRIVATE);store=new File(getFilesDir(),"articles");store.mkdirs();
  try{extractor=new String(readAll(getAssets().open("extract.js"),1024*1024),StandardCharsets.UTF_8);}catch(Exception e){throw new IllegalStateException(e);}
  frame=new FrameLayout(this);frame.setBackgroundColor(Color.rgb(244,243,238));setContentView(frame);
  frame.setOnApplyWindowInsetsListener((v,insets)->{v.setPadding(insets.getSystemWindowInsetLeft(),insets.getSystemWindowInsetTop(),insets.getSystemWindowInsetRight(),insets.getSystemWindowInsetBottom());return insets;});
  source=new WebView(this);configure(source,true);
  // A desktop document avoids the mobile site's automatic App handoff, while the reader itself is adaptive.
  source.getSettings().setUserAgentString("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36");
  source.setWebViewClient(new SourceClient());source.setWebChromeClient(new WebChromeClient());frame.addView(source,new FrameLayout.LayoutParams(-1,-1));
  reader=new WebView(this);configure(reader,false);reader.addJavascriptInterface(new Bridge(),"ReaderNative");reader.setWebViewClient(new ReaderClient());reader.setWebChromeClient(new WebChromeClient());frame.addView(reader,new FrameLayout.LayoutParams(-1,-1));
  loginBar=new LinearLayout(this);loginBar.setGravity(Gravity.CENTER_VERTICAL);loginBar.setBackgroundColor(Color.rgb(244,243,238));loginBar.setPadding(dp(12),dp(4),dp(12),dp(4));Button done=new Button(this);done.setText("‹ 返回阅读");done.setContentDescription("完成登录，返回阅读器");done.setOnClickListener(v->leaveLogin());loginBar.addView(done,new LinearLayout.LayoutParams(-1,dp(48)));FrameLayout.LayoutParams bar=new FrameLayout.LayoutParams(-1,dp(64),Gravity.BOTTOM);frame.addView(loginBar,bar);loginBar.setVisibility(View.GONE);
  CookieManager.getInstance().setAcceptCookie(true);CookieManager.getInstance().setAcceptThirdPartyCookies(source,false);
  publications=new PublicationClient((provider,type,url,payload)->{
   final CountDownLatch latch=new CountDownLatch(1);final String[] result={null};
   ui.post(()->reader.evaluateJavascript("(function(){try{return {ok:window.parsePublication("+JSONObject.quote(provider)+","+JSONObject.quote(type)+","+JSONObject.quote(url)+","+(payload instanceof String?JSONObject.quote((String)payload):payload.toString())+")}}catch(e){return {error:e.message}}})()",r->{result[0]=r;latch.countDown();}));
   if(!latch.await(30,TimeUnit.SECONDS))throw new IOException("解析超时");JSONObject parsed=new JSONObject(result[0]);if(parsed.has("error"))throw new IOException(parsed.getString("error"));return parsed.getJSONObject("ok");
  });
  reader.loadUrl(ORIGIN+"index.html");
 }
 private int dp(int n){return Math.round(n*getResources().getDisplayMetrics().density);}
 private void configure(WebView web,boolean remote){WebSettings s=web.getSettings();s.setJavaScriptEnabled(true);s.setDomStorageEnabled(true);s.setAllowFileAccess(false);s.setAllowContentAccess(false);s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);s.setSupportMultipleWindows(false);s.setJavaScriptCanOpenWindowsAutomatically(false);s.setBuiltInZoomControls(remote);s.setDisplayZoomControls(false);s.setLoadWithOverviewMode(remote);s.setUseWideViewPort(true);s.setMediaPlaybackRequiresUserGesture(true);web.setBackgroundColor(Color.rgb(244,243,238));}
 private static boolean allowed(String raw){return PublicationClient.allowed(raw);}
 private static String articleId(String raw){try{java.util.regex.Matcher m=java.util.regex.Pattern.compile("/(\\d+)(?:_\\d+)?\\.html$").matcher(new URI(raw).getPath());return m.find()?m.group(1):"";}catch(Exception e){return "";}}
 private static boolean same(String a,String b){return allowed(b)&&!articleId(a).isEmpty()&&articleId(a).equals(articleId(b))&&Uri.parse(a).getHost().equals(Uri.parse(b).getHost());}
 private void send(String id,JSONObject data){ui.post(()->reader.evaluateJavascript("window.receiveNative("+JSONObject.quote(id)+","+data.toString()+")",null));}
 private JSONObject obj(String... pairs){JSONObject o=new JSONObject();try{for(int i=0;i<pairs.length;i+=2)o.put(pairs[i],pairs[i+1]);}catch(Exception ignored){}return o;}
 private void stage(String text){send(requestId,obj("state","loading","stage",text));}
 private void fail(String error){if(!loading)return;loading=false;source.stopLoading();send(requestId,obj("state","error","error",error));}
 private String account(){String cookies=CookieManager.getInstance().getCookie("https://weekly.caixin.com/");TreeMap<String,String> ids=new TreeMap<>();if(cookies!=null)for(String c:cookies.split(";")){int i=c.indexOf('=');if(i>0){String n=c.substring(0,i).trim();if(Arrays.asList("UID","SA_USER_UID","SA_USER_auth","USER_LOGIN_CODE").contains(n))ids.put(n,c.substring(i+1));}}return sha(prefs.getString("sessionEpoch","initial")+ids.toString());}
 private File folder(String ns,String url){return new File(store,sha(ns+"|"+url));}
 private void read(String type,String url,boolean force,String id){
  ++generation;source.stopLoading();loading=false;if(!allowed(url)||!Arrays.asList("shelf","issue","article").contains(type)||(type.equals("article")&&PublicationClient.provider(url).equals("caixin")&&articleId(url).isEmpty())){send(id,obj("state","error","error","仅支持四刊官方 HTTPS 页面"));return;}
  mode=type;requested=url;requestId=id;namespace=sha(PublicationClient.provider(url)+"|"+prefs.getString("epoch-"+PublicationClient.provider(url),"initial"));combined=null;expected=new JSONArray();expanded=false;pages=0;visited.clear();stable=0;lastChars=0;began=System.currentTimeMillis();loading=true;int g=generation;final String readNamespace=namespace;
  disk.execute(()->{JSONObject cached=null;if(!force)try{File f=new File(folder(readNamespace,url),"article.json");if(f.exists()){cached=new JSONObject(new String(readAll(new FileInputStream(f),8*1024*1024),StandardCharsets.UTF_8));if(!url.equals(cached.optString("url"))||(type.equals("article")&&!"complete".equals(cached.optString("access"))))cached=null;else cached.put("cacheHit",true);}}catch(Exception ignored){}final JSONObject hit=cached;ui.post(()->{if(g!=generation)return;if(hit!=null){finish(hit,false);return;}stage("正在读取官网" );
   if(!PublicationClient.provider(url).equals("caixin")){
    network.execute(()->{try{JSONObject result=publications.read(type,url,prefs.getString("cbnToken",""));ui.post(()->{if(g==generation){try{finish(result,!type.equals("article")||result.optString("access").equals("complete"));}catch(Exception e){fail("读取失败");}}});}catch(Exception e){ui.post(()->{if(g==generation)fail(e.getMessage());});}});
    return;
   }navigate(url);ui.postDelayed(()->{if(g==generation&&loading)fail("读取超时，请检查网络或在应用内登录财新");},45000);});});
 }
 private String committedUrl=""; private int navigation=0;
 private void navigate(String url){navigation++;committedUrl="";pages++;visited.add(url);stable=0;lastChars=0;pageBegan=System.currentTimeMillis();source.loadUrl(url);int g=generation;ui.postDelayed(()->poll(g),300);}
 private void poll(int g){if(g!=generation||!loading||login)return;String current=source.getUrl();if(!java.util.Objects.equals(committedUrl,current)){ui.postDelayed(()->poll(g),300);return;}if(current==null||(!mode.equals("article")&&!allowed(current))||(mode.equals("article")&&!same(requested,current))){ui.postDelayed(()->poll(g),300);return;}
  final int navigationVersion=navigation;String script=extractor.replace("__MODE__",JSONObject.quote(mode));source.evaluateJavascript(script,raw->{if(g!=generation||navigationVersion!=navigation||!loading)return;try{JSONObject snap=new JSONObject(raw);if(!snap.optBoolean("ready")){ui.postDelayed(()->poll(g),300);return;}if(!mode.equals("article")){finish(snap.getJSONObject("data"),true);return;}
   long age=System.currentTimeMillis()-pageBegan;if(snap.optBoolean("locked")){if(age<7000){ui.postDelayed(()->poll(g),350);return;}JSONObject d=snap.getJSONObject("data");d.put("access","restricted");d.put("reason","财新仍显示登录或订阅提示。请在应用内登录并确认本文权限。");finish(d,false);return;}
   int chars=snap.optInt("chars");stable=chars==lastChars?stable+1:0;lastChars=chars;String all=snap.optString("all"),next=snap.optString("next");boolean terminal=snap.optBoolean("terminal");
   if(all.isEmpty()&&next.isEmpty()&&!terminal&&(age<2500||stable<2)){ui.postDelayed(()->poll(g),300);return;}
   JSONArray nav=snap.optJSONArray("chapters");if(nav!=null&&nav.length()>expected.length())expected=nav;
   JSONObject part=snap.getJSONObject("data");if(combined==null)combined=part;else combined.put("blocks",merge(combined.getJSONArray("blocks"),part.getJSONArray("blocks")));
   if(!all.isEmpty()&&!expanded&&same(requested,all)&&!visited.contains(all)){expanded=true;stage("正在展开余下全文");navigate(all);return;}
   String body=body(combined.getJSONArray("blocks"));int covered=0;String missing="";for(int i=0;i<expected.length();i++){JSONObject ch=expected.getJSONObject(i);if(body.contains(ch.getString("title")))covered++;else if(missing.isEmpty()&&same(requested,ch.optString("url"))&&!visited.contains(ch.optString("url")))missing=ch.optString("url");}
   String follow=!next.isEmpty()?next:missing;if(!follow.isEmpty()&&same(requested,follow)&&!visited.contains(follow)&&pages<50){stage("正在补齐正文 · "+pages);navigate(follow);return;}
   boolean complete=follow.isEmpty()&&(expected.length()==0||covered==expected.length())&&(terminal||(expanded&&expected.length()>0));
   combined.put("access",complete?"complete":(!follow.isEmpty()||covered<expected.length()?"partial":"unverified"));combined.put("reason",complete?"已核对全文与章节":"正文已读取，完整性尚未核对，请对照原文");combined.put("chapters",expected);combined.put("covered",covered);combined.put("pagesRead",pages);finish(combined,complete);
  }catch(Exception e){if(System.currentTimeMillis()-pageBegan<10000)ui.postDelayed(()->poll(g),400);else fail("页面结构无法识别，请打开原文确认内容");}});
 }
 private static String body(JSONArray blocks)throws JSONException{StringBuilder b=new StringBuilder();for(int i=0;i<blocks.length();i++){JSONObject o=blocks.getJSONObject(i);if(!o.optString("type").equals("image"))b.append(o.optString("text")).append('\n');}return b.toString();}
 private static String key(JSONObject b){return b.optString("type").equals("image")?"image:"+b.optString("src"):b.optString("type")+":"+b.optString("text");}
 private static JSONArray merge(JSONArray a,JSONArray b)throws JSONException{List<String> at=new ArrayList<>(),bt=new ArrayList<>();for(int i=0;i<a.length();i++)if(!a.getJSONObject(i).optString("type").equals("image"))at.add(key(a.getJSONObject(i)));for(int i=0;i<b.length();i++)if(!b.getJSONObject(i).optString("type").equals("image"))bt.add(key(b.getJSONObject(i)));if(!at.isEmpty()&&bt.size()>=at.size()&&bt.subList(0,at.size()).equals(at))return b;int overlap=0;for(int n=1;n<=Math.min(a.length(),b.length());n++){boolean eq=true;for(int i=0;i<n;i++)if(!key(a.getJSONObject(a.length()-n+i)).equals(key(b.getJSONObject(i)))){eq=false;break;}if(eq)overlap=n;}JSONArray out=new JSONArray();String lead="";for(int i=0;i<a.length();i++){JSONObject x=a.getJSONObject(i);out.put(x);if(lead.isEmpty()&&x.optString("type").equals("image"))lead=x.optString("src");}for(int i=overlap;i<b.length();i++){JSONObject x=b.getJSONObject(i);if(!lead.isEmpty()&&x.optString("type").equals("image")&&x.optString("src").equals(lead))continue;out.put(x);}return out;}
 private void finish(JSONObject d,boolean cache){loading=false;source.stopLoading();CookieManager.getInstance().flush();try{if(mode.equals("article")&&(d.optJSONArray("blocks")==null||d.getJSONArray("blocks").length()==0)){send(requestId,obj("state","error","error","官网返回空正文，未覆盖缓存"));return;}d.put("url",requested);d.put("elapsedMs",System.currentTimeMillis()-began);if(!d.has("fetchedAt"))d.put("fetchedAt",System.currentTimeMillis());final String ns=namespace,url=requested;String raw=d.toString();
  if(mode.equals("article")){JSONArray blocks=d.getJSONArray("blocks");for(int i=0;i<blocks.length();i++){JSONObject b=blocks.getJSONObject(i);if(b.optString("type").equals("image")&&allowed(b.optString("src"))){String src=b.getString("src"),id=sha(ns+"|"+src);assets.put(id,src);referers.put(id,url);b.put("src",ORIGIN+"media/"+id);}}}
  rewriteCovers(d,ns,url);JSONObject result=new JSONObject();result.put("state","done");result.put("data",d);final String responseId=requestId;
  if(cache){disk.execute(()->{try{
   JSONObject rawData=new JSONObject(raw);JSONArray bs=rawData.optJSONArray("blocks");
   if(bs!=null)for(int i=0;i<bs.length();i++){JSONObject block=bs.getJSONObject(i);if(block.optString("type").equals("image")){String src=block.getString("src"),imageId=sha(ns+"|"+src);assets.put(imageId,src);referers.put(imageId,url);WebResourceResponse response=imageResponse(imageId);response.getData().close();}}
   File dir=folder(ns,url);dir.mkdirs();write(new File(dir,"article.json"),raw.getBytes(StandardCharsets.UTF_8));send(responseId,result);
  }catch(Exception e){try{d.put("cacheWarning","配图尚未完整缓存，下次重试");result.put("data",d);}catch(Exception ignored){}send(responseId,result);}
  });}else send(responseId,result);
 }catch(Exception e){send(requestId,obj("state","error","error","正文处理失败"));}}
 private void rewriteCovers(Object value,String ns,String ref)throws JSONException{if(value instanceof JSONObject){JSONObject o=(JSONObject)value;Iterator<String> keys=o.keys();while(keys.hasNext()){String k=keys.next();Object v=o.get(k);if(k.equals("cover")&&v instanceof String&&allowed((String)v)){String id=sha(ns+"|"+v);assets.put(id,(String)v);referers.put(id,ref);o.put(k,ORIGIN+"media/"+id);}else rewriteCovers(v,ns,ref);}}else if(value instanceof JSONArray){JSONArray a=(JSONArray)value;for(int i=0;i<a.length();i++)rewriteCovers(a.get(i),ns,ref);}}
 // WebView padding does not reserve space for fixed HTML headers. Resize the native view instead.
 private void setLoginViewport(boolean active){FrameLayout.LayoutParams p=(FrameLayout.LayoutParams)source.getLayoutParams();p.bottomMargin=active?dp(64):0;source.setLayoutParams(p);}
 private void openLogin(String url){generation++;loading=false;source.stopLoading();login=true;assets.clear();referers.clear();reader.setVisibility(View.GONE);loginBar.setVisibility(View.VISIBLE);setLoginViewport(true);source.loadUrl(allowed(url)?url:"https://weekly.caixin.com/");}
 private void leaveLogin(){
  if(source.getUrl()!=null&&source.getUrl().startsWith("https://www.cbnweek.com/")){
   source.evaluateJavascript("localStorage.getItem('Authorization')",r->{try{Object token=new JSONTokener(r).nextValue();if(token instanceof String)prefs.edit().putString("cbnToken",(String)token).apply();}catch(Exception ignored){}completeLogin();});
  }else completeLogin();
 }
 private void completeLogin(){publications.issues.clear();login=false;source.stopLoading();setLoginViewport(false);CookieManager.getInstance().flush();loginBar.setVisibility(View.GONE);reader.setVisibility(View.VISIBLE);reader.evaluateJavascript("window.loginReturned()",null);}
 @Override public void onConfigurationChanged(Configuration config){super.onConfigurationChanged(config);reader.evaluateJavascript("window.foldChanged&&window.foldChanged()",null);}
 @Override protected void onPause(){super.onPause();CookieManager.getInstance().flush();reader.evaluateJavascript("window.saveReading&&window.saveReading()",null);}
 @Override public void onBackPressed(){if(login){leaveLogin();return;}reader.evaluateJavascript("window.readerBack()",null);}
 @Override protected void onDestroy(){generation++;loading=false;reader.destroy();source.destroy();disk.shutdown();network.shutdownNow();super.onDestroy();}
 private class SourceClient extends WebViewClient{
  @Override public void onPageStarted(WebView v,String url,android.graphics.Bitmap icon){committedUrl="";}
  @Override public void onPageCommitVisible(WebView v,String url){committedUrl=url;}
  @Override public boolean shouldOverrideUrlLoading(WebView v,WebResourceRequest r){String url=r.getUrl().toString();if(!r.isForMainFrame())return false;if(!allowed(url)){if(login)Toast.makeText(MainActivity.this,"请使用财新网页内的账号/手机号登录；暂不支持外部 App 跳转",Toast.LENGTH_LONG).show();else fail("网站要求跳转到外部页面，请在应用内确认登录");return true;}if(!login&&mode.equals("article")&&!same(requested,url)){fail("网站跳转到登录或其他页面，请先登录财新");return true;}return false;}
  @Override public void onReceivedError(WebView v,WebResourceRequest r,WebResourceError e){if(r.isForMainFrame()&&!login)fail("网络加载失败，请重试或检查网络");}
  @Override public WebResourceResponse shouldInterceptRequest(WebView v,WebResourceRequest r){if(login||r.isForMainFrame())return null;String h=r.getUrl().getHost(),p=r.getUrl().getPath();if((h!=null&&h.matches("pinggai\\d*\\.caixin\\.com"))||(p!=null&&(p.startsWith("/webjs/comment/")||p.startsWith("/modules/cx-audio/"))))return empty();return null;}
 }
 private class ReaderClient extends WebViewClient{
  @Override public boolean shouldOverrideUrlLoading(WebView v,WebResourceRequest r){return !r.getUrl().toString().equals(ORIGIN+"index.html");}
  @Override public WebResourceResponse shouldInterceptRequest(WebView v,WebResourceRequest r){Uri u=r.getUrl();if(!"reader.local".equals(u.getHost()))return empty();String path=u.getPath();try{if(path.startsWith("/media/")){String id=path.substring(7);if(!id.matches("[a-f0-9]{64}")||!assets.containsKey(id))return empty();return imageResponse(id);}if(!Arrays.asList("/index.html","/app.js","/style.css","/providers.js").contains(path))return empty();String mime=path.endsWith(".js")?"application/javascript":path.endsWith(".css")?"text/css":"text/html";Map<String,String> headers=new HashMap<>();headers.put("Content-Security-Policy","default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'none'; frame-src 'none'; base-uri 'none'");return new WebResourceResponse(mime,"UTF-8",200,"OK",headers,getAssets().open(path.substring(1)));}catch(Exception e){return empty();}}
 }
 private static WebResourceResponse empty(){return new WebResourceResponse("text/plain","UTF-8",new ByteArrayInputStream(new byte[0]));}
 private WebResourceResponse imageResponse(String id)throws Exception{File dir=new File(getFilesDir(),"images");dir.mkdirs();File bin=new File(dir,id+".bin"),meta=new File(dir,id+".type");if(bin.exists()&&meta.exists())return new WebResourceResponse(new String(readAll(new FileInputStream(meta),100),StandardCharsets.UTF_8),null,new FileInputStream(bin));String url=assets.get(id),ref=referers.get(id);for(int i=0;i<5;i++){if(!allowed(url))throw new IOException();URL target=new URL(url);for(InetAddress ip:InetAddress.getAllByName(target.getHost()))if(ip.isAnyLocalAddress()||ip.isLoopbackAddress()||ip.isLinkLocalAddress()||ip.isSiteLocalAddress())throw new IOException();HttpURLConnection c=(HttpURLConnection)target.openConnection();c.setInstanceFollowRedirects(false);c.setConnectTimeout(10000);c.setReadTimeout(15000);if(ref!=null)c.setRequestProperty("Referer",ref);String ck=CookieManager.getInstance().getCookie(url);if(ck!=null)c.setRequestProperty("Cookie",ck);try{int status=c.getResponseCode();if(status>=300&&status<400){url=new URL(target,c.getHeaderField("Location")).toString();continue;}if(status!=200)throw new IOException();String mime=c.getContentType();if(mime==null||!mime.split(";")[0].matches("image/(jpeg|png|gif|webp|avif)"))throw new IOException();byte[] bytes=readAll(c.getInputStream(),12*1024*1024);if(!assets.containsKey(id))throw new IOException();write(bin,bytes);write(meta,mime.split(";")[0].getBytes(StandardCharsets.UTF_8));disk.execute(()->{try{prune();}catch(Exception ignored){}});return new WebResourceResponse(mime.split(";")[0],null,new ByteArrayInputStream(bytes));}finally{c.disconnect();}}throw new IOException();}
 private void prune(){}
 private static void collect(File dir,List<File> out){File[] fs=dir.listFiles();if(fs!=null)for(File f:fs)if(f.isDirectory())collect(f,out);else out.add(f);}
 private static void delete(File f){if(f.isDirectory()){File[] children=f.listFiles();if(children!=null)for(File c:children)delete(c);}f.delete();}
 private static byte[] readAll(InputStream in,int max)throws IOException{try(InputStream input=in;ByteArrayOutputStream out=new ByteArrayOutputStream()){byte[] b=new byte[16384];int n,total=0;while((n=input.read(b))!=-1){total+=n;if(total>max)throw new IOException("内容过大");out.write(b,0,n);}return out.toByteArray();}}
 private static synchronized void write(File f,byte[] bytes)throws IOException{f.getParentFile().mkdirs();File tmp=new File(f.getPath()+".tmp");try(FileOutputStream out=new FileOutputStream(tmp)){out.write(bytes);}if(!tmp.renameTo(f))throw new IOException("缓存写入失败");}
 private static String sha(String s){try{byte[] b=MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8));StringBuilder out=new StringBuilder();for(byte x:b)out.append(String.format("%02x",x));return out.toString();}catch(Exception e){throw new IllegalStateException(e);}}
 public class Bridge{
  @JavascriptInterface public void load(String type,String url,boolean force,String id){ui.post(()->read(type,url,force,id));}
  @JavascriptInterface public void cancel(){ui.post(()->{generation++;loading=false;source.stopLoading();});}
  @JavascriptInterface public void login(String url){ui.post(()->{if(allowed(url)){openLogin(url);}});}
  @JavascriptInterface public void original(String url){ui.post(()->{if(allowed(url))openLogin(url);});}
  @JavascriptInterface public void clearArticle(String url){if(!allowed(url))return;String ns=sha(PublicationClient.provider(url)+"|"+prefs.getString("epoch-"+PublicationClient.provider(url),"initial"));disk.execute(()->delete(folder(ns,url)));}
  @JavascriptInterface public void clearCache(){ui.post(()->{generation++;loading=false;source.stopLoading();assets.clear();referers.clear();disk.execute(()->{delete(store);store.mkdirs();delete(new File(getFilesDir(),"images"));ui.post(()->reader.evaluateJavascript("window.cacheCleared()",null));});});}
  @JavascriptInterface public void disconnect(){ui.post(()->{generation++;loading=false;source.stopLoading();assets.clear();referers.clear();CookieManager.getInstance().removeAllCookies(done->{CookieManager.getInstance().flush();WebStorage.getInstance().deleteAllData();source.clearCache(true);source.clearHistory();prefs.edit().remove("route").remove("cbnToken").putString("sessionEpoch",UUID.randomUUID().toString()).apply();disk.execute(()->{delete(store);store.mkdirs();delete(new File(getFilesDir(),"images"));});reader.evaluateJavascript("window.disconnected()",null);});});}
  @JavascriptInterface public String restore(){return prefs.getString("route","{}");}
  @JavascriptInterface public void save(String state){if(state!=null&&state.length()<30000)prefs.edit().putString("route",state).apply();}
  @JavascriptInterface public String cacheInfo(){List<File> fs=new ArrayList<>();collect(store,fs);collect(new File(getFilesDir(),"images"),fs);long n=0;for(File f:fs)n+=f.length();return String.format(Locale.ROOT,"%.1f MB · 完整缓存长期保留",n/1048576.0);}
  @JavascriptInterface public void exit(){ui.post(()->finish());}
 }
}
