# vivo X Fold5 安卓阅读器可行性

日期：2026-09-19。按用户所说的“VIVO Fold X5”为 vivo X Fold5 评估。本轮为调研，不包含 APK 开发或真机验收。

## 结论

可做成独立安装的 APK：原生 Android 外壳 + 本地 H5 阅读界面 + 受限财新 WebView 读取器。不是把当前 localhost 页面简单打包；现有 Node/Playwright 后端需要用 Android WebView、原生 HTTP 和本地存储替换。手机可独立使用，无须电脑开机。

vivo 官方参数确认 X Fold5 属于 Android 设备，国行出厂系统基于 Android 15；用户当前升级后的系统版本需真机确认。[vivo 参数](https://www.vivo.com.cn/vivo/param/xfold5)

## 三种方式比较

| 方式 | 登录复用 | 自定义纯正文排版 | 结论 |
| --- | --- | --- | --- |
| 手机浏览器打开普通 H5 | 只能按网站自身 Cookie 规则访问；阅读器网页不能跨域读取财新登录及正文 | 直接跨域抓取受同源/CORS限制；需要后端或网站合作 | 仅靠一个静态 H5 不够 |
| APK + Custom Tabs | 与承载它的浏览器共享登录状态 | 宿主访问网页数据受到严格限制，不能任意读取 DOM | 适合“打开原文”，不适合主读取引擎 |
| APK + WebView + 本地 H5 | APK 自有 Cookie 存储，首次需在财新真实网页登录 | 可从已获授权、已渲染的页面提取正文并在本地展示 | 建议先做小型验证版 |

Custom Tabs 与 WebView 登录隔离差异以及数据访问限制参见 [Chromium 官方安全说明](https://chromium.googlesource.com/chromium/src.git/+/HEAD/docs/security/custom-tabs-faq.md)。WebView 支持应用嵌入网页及脚本，但不会自动带来桌面扩展能力。[Android WebView](https://developer.android.com/develop/ui/views/layout/webapps/webview)

## 登录与订阅风险

1. 在 APK 的财新 WebView 中显示真实 HTTPS 登录页，密码和验证码由用户自行输入。不需要把电脑 Cookie 传到手机，也不要求重复登录每一篇文章。
2. WebView 使用 CookieManager 管理会话；原生 HTTP 请求需要按目标域、路径和安全属性同步合适的 Cookie，并处理 Set-Cookie。不能直接把 Cookie 请求头发给所有资源域名。跨站登录是否需要第三方 Cookie，需依据实际跳转测试，不默认放开所有第三方站点。[CookieManager](https://developer.android.com/reference/android/webkit/CookieManager)
3. 短信验证码、微信跳转登录、验证码挑战、设备验证和会话过期都需要实测。登录若转入外部浏览器，其 Cookie 不会自动回到 WebView。优先验证财新已有的手机号/账号登录流程。
4. 订阅权益属于财新账号；APK 不会扩大可阅读产品范围。财新官方说明电脑、移动设备可使用同一订阅，但同类终端多设备登录可能把前一设备退出。官方资料不能确认“同一手机上的官方 App、浏览器、私人 WebView”具体如何计数，必须实测共存和退出行为。[财新订阅 FAQ](https://m.caixin.com/m/subscribe/)
5. 网站可能调整页面、拦截 WebView 或要求额外验证。技术可行不代表财新承诺兼容第三方客户端。个人安装与公开分发是不同范围；本方案只评估个人使用。

## 折叠屏设计

以实际窗口宽度决定布局，不通过型号固定横竖屏：外屏采用单栏；内屏可采用目录 + 正文，或用户可选双栏。折叠/展开时保持文章、字号、主题与段落阅读位置，避免 Activity 重建导致重新鉴权和丢失进度。图片缩放适配内外屏与分屏窗口。[Android 折叠屏指引](https://developer.android.com/develop/adaptive-apps/guides/foldables/learn-about-foldables)

这里“双屏”指外屏/内屏切换与适配，不承诺同时向两个物理屏幕显示不同内容，后者取决于设备系统能力。

## 建议实现与权限

- Kotlin 应用管理导航、生命周期、Cookie、缓存；可复用现有 H5 样式及结构化文章模型，不能原样复用服务器运行时。
- 独立财新读取 WebView 正常执行网站登录和鉴权；本地阅读 WebView 只渲染净化后的正文，不执行远端文章脚本。
- 原生 HTTP 仅用于验证可直接读取的页面及图片；动态文章正常由 WebView 完成加载与全文展开，不绕过付费墙。
- 最小系统权限为联网；私有缓存不需要全盘文件权限。不要申请短信读取、通讯录、无障碍或系统悬浮窗权限。登录验证码由用户输入。
- 会话和付费内容仅存应用私有目录；退出清除会话，提供清缓存。备份规则排除会话秘密。
- 安装使用签名 APK；手机需要给实际安装来源授权。保留签名密钥，以便后续原位升级；能否上架应用商店不在本轮验证范围。

## 真机验证门槛

先实现最小验证：官网登录 → 重启后保持会话 → 两篇样本全文和图片 → 内外屏切换不丢进度 → 与官方 App 的登录共存 → 清缓存/退出。验证通过后再搬完整书架和目录。

性能分别记录：空缓存首次读取、浏览器已启动读取、正文缓存命中、图片完成、折叠恢复。不能沿用桌面成绩或承诺所有首次全文 1 秒内；缓存首屏低于 1 秒可以作为明确目标。
