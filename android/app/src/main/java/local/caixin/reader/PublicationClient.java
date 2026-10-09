package local.caixin.reader;
import org.json.*;
import android.webkit.CookieManager;
import java.net.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import java.util.regex.*;

/** Official HTTP endpoints, using only the selected publication's application login. */
final class PublicationClient {
 interface Parser {JSONObject parse(String provider,String mode,String url,Object payload)throws Exception;}
 final Parser parser;String[] signParts;final Map<String,JSONObject> issues=new LinkedHashMap<>();
 PublicationClient(Parser parser){this.parser=parser;}
 static String provider(String raw){String h=URI.create(raw).getHost();if(h==null)return "";if(h.endsWith("caixin.com"))return "caixin";if(h.endsWith("eeo.com.cn"))return "eeo";if(h.endsWith("mycaijing.com")||h.equals("res.caijingmobile.com"))return "caijing";return "cbnweek";}
 static boolean allowed(String raw){try{URI u=new URI(raw);String h=u.getHost();return u.getScheme().equals("https")&&u.getPort()==-1&&u.getUserInfo()==null&&h!=null&&(h.equals("caixin.com")||h.endsWith(".caixin.com")||Arrays.asList("www.eeo.com.cn","epaper.eeo.com.cn","api.eeo.com.cn","app.eeo.com.cn","img.eeo.com.cn","upload.eeo.com.cn","www.mycaijing.com","res.caijingmobile.com","www.cbnweek.com","api.cbnweek.com","imgcdn.cbnweek.com","imgcdn.yicai.com").contains(h));}catch(Exception e){return false;}}
 String http(String url,String method,Map<String,String> headers)throws Exception{
  String origin=new URI(url).getHost();
  for(int redirects=0;redirects<5;redirects++){
   if(!allowed(url))throw new IOException("非本站请求已阻止");
   for(InetAddress ip:InetAddress.getAllByName(new URL(url).getHost()))if(ip.isLoopbackAddress()||ip.isSiteLocalAddress()||ip.isLinkLocalAddress())throw new IOException("地址无效");
   HttpURLConnection c=(HttpURLConnection)new URL(url).openConnection();c.setRequestMethod(method);c.setInstanceFollowRedirects(false);c.setConnectTimeout(12000);c.setReadTimeout(20000);
   c.setRequestProperty("User-Agent","Mozilla/5.0 Chrome/131.0.0.0 Safari/537.36");
   String ck=CookieManager.getInstance().getCookie(url);if(ck!=null)c.setRequestProperty("Cookie",ck);
   if(new URI(url).getHost().equals(origin))for(Map.Entry<String,String> h:headers.entrySet())c.setRequestProperty(h.getKey(),h.getValue());
   try{int code=c.getResponseCode();if(code>=300&&code<400){url=new URL(new URL(url),c.getHeaderField("Location")).toString();continue;}
    if(code!=200)throw new IOException("官网返回 "+code);
    ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] buf=new byte[16384];try(InputStream in=c.getInputStream()){int n;while((n=in.read(buf))!=-1){out.write(buf,0,n);if(out.size()>32*1024*1024)throw new IOException("数据过大");}}
    return new String(out.toByteArray(),StandardCharsets.UTF_8);
   }finally{c.disconnect();}
  }throw new IOException("重定向过多");
 }
 String get(String u)throws Exception{return http(u,"GET",Collections.emptyMap());}
 Object api(String path,String signature,String token)throws Exception{
  if(signParts==null){Matcher m=Pattern.compile("src=[\"']?([^\"' >]*/app[.][^\"' >]+[.]js)").matcher(get("https://www.cbnweek.com/read"));if(!m.find())throw new IOException("官网脚本已变化");String script=get(new URL(new URL("https://www.cbnweek.com"),m.group(1)).toString());Matcher parts=Pattern.compile("\\(\"([^\"]+)\"\\+decodeURI\\(e\\)\\+\"([^\"]+)\"\\)").matcher(script);if(!parts.find())throw new IOException("官网请求格式已变化");signParts=new String[]{parts.group(1),parts.group(2)};}
  byte[] digest=MessageDigest.getInstance("MD5").digest((signParts[0]+signature+signParts[1]).getBytes(StandardCharsets.UTF_8));StringBuilder hex=new StringBuilder();for(byte b:digest)hex.append(String.format("%02x",b));
  Map<String,String> headers=new HashMap<>();headers.put("X-Signature",android.util.Base64.encodeToString(hex.toString().getBytes(StandardCharsets.UTF_8),android.util.Base64.NO_WRAP));headers.put("ClientVersion","4.0.0");headers.put("ClientPlatform","PC");if(!token.isEmpty())headers.put("Authorization",token);
  JSONObject j=new JSONObject(http("https://api.cbnweek.com"+path,"GET",headers));if(j.optInt("code",-1)!=0)throw new IOException("请重新登录第一财经并确认订阅权限");return j.get("data");
 }
 JSONObject read(String mode,String url,String token)throws Exception{
  String p=provider(url);
  if(p.equals("cbnweek")){
   String id=new URI(url).getPath().replaceAll(".*/","");
   if(mode.equals("shelf")){JSONArray groups=new JSONArray(),years=(JSONArray)api("/v5/magazines/years","","");Set<String> unique=new TreeSet<>(Collections.reverseOrder());for(int i=0;i<years.length();i++){JSONObject row=years.getJSONObject(i);Iterator<String> keys=row.keys();while(keys.hasNext()){JSONArray ys=row.getJSONArray(keys.next());for(int j=0;j<ys.length();j++)unique.add(ys.getString(j));}}for(String year:unique){JSONArray rows=(JSONArray)api("/v5/magazines?year="+year+"&type=",year,"");for(int i=0;i<rows.length();i++)groups.put(rows.get(i));}return parser.parse(p,mode,url,groups);}
   if(mode.equals("article"))return parser.parse(p,mode,url,api("/v5/articles/"+id,"",token));
   boolean subject=url.contains("read_");JSONObject info=(JSONObject)api("/v5/"+(subject?"subjects/":"magazines/")+id,subject?id:"",token);JSONArray groups;
   if(subject){if(!info.optBoolean("is_jurisdiction"))throw new IOException("单行本需要订阅权限");JSONArray all=new JSONArray();for(int page=1;page<=500;page++){JSONArray rows=(JSONArray)api("/v5/subjects/"+id+"/articles?per=20&page="+page,"",token);if(rows.length()==0)break;for(int i=0;i<rows.length();i++)all.put(rows.get(i));if(all.length()>=info.optInt("articles_count",Integer.MAX_VALUE))break;}groups=new JSONArray().put(new JSONObject().put("articles",all));}
   else groups=(JSONArray)api("/v5/magazines/"+id+"/articles","",token);
   return parser.parse(p,mode,url,new JSONObject().put("info",info).put("groups",groups));
  }
  if(p.equals("caijing")){
   if(!mode.equals("shelf"))return parser.parse(p,mode,url,get(url));
   JSONArray all=new JSONArray();
   for(int type=0;type<=1;type++){String html=get("https://www.mycaijing.com/issue?type="+type);Matcher m=Pattern.compile("data-year=[\"'](\\d{4})[\"']").matcher(html);Set<String> years=new TreeSet<>(Collections.reverseOrder());while(m.find())years.add(m.group(1));if(years.isEmpty())throw new IOException("未发现期刊年份");
    for(String year:years)for(int page=1;page<=1000;page++){JSONObject j=new JSONObject(http("https://www.mycaijing.com/issue/ajax-list?year="+year+"&type="+type+"&page="+page,"POST",Collections.emptyMap())).getJSONObject("data");all.put(new JSONObject().put("year",year).put("type",type).put("items",j.getJSONArray("data")));if(page>=j.getInt("last_page"))break;}
   }return parser.parse(p,mode,url,all);
  }
  if(mode.equals("shelf")){JSONArray all=new JSONArray();String cursor="https://www.eeo.com.cn/epaper/eeocover/1.shtml";Set<String> seen=new HashSet<>();while(!cursor.isEmpty()&&seen.add(cursor)&&seen.size()<=500){JSONObject page=parser.parse(p,mode,cursor,get(cursor));JSONArray rows=page.getJSONArray("issues");for(int i=0;i<rows.length();i++)all.put(rows.get(i));String next=page.optString("next");if(next.isEmpty()||next.startsWith("javascript:"))break;cursor=new URL(new URL(cursor),next).toString().replace("http://","https://");}return new JSONObject().put("issues",all);}
  String qid=android.net.Uri.parse(url).getQueryParameter("qid");if(qid==null||!qid.matches("\\d+"))throw new IOException("期号无效");
  JSONObject payload=issues.get(qid);
  if(payload==null){Matcher m=Pattern.compile("\\$\\.get\\(\"(https://api\\.eeo\\.com\\.cn/[^\"\\n]+action=getEpaper[^\"\\n]+qid=)\"").matcher(get("https://epaper.eeo.com.cn/epaper/js/index.js"));if(!m.find())throw new IOException("电子报接口已变化");payload=new JSONObject(get(m.group(1)+qid));if(issues.size()>=4)issues.clear();issues.put(qid,payload);}
  return parser.parse(p,mode,url,payload);
 }
}
