# 财新折叠屏阅读器 Android

独立的个人阅读 APK，支持窄屏单栏、宽屏目录＋正文。首次在应用内登录财新；不依赖电脑服务，不读取 Chrome 的会话。

## 安装

将 `dist/caixin-fold-reader-1.0.1.apk` 传到 vivo X Fold5，在文件管理器中打开并按系统提示允许该来源安装。启动后右上角设置 → 在应用内登录财新 → 底部“返回阅读”。

展开／折叠时自动适配应用窗口，接续行为还受 OriginOS 系统设置影响。当前是真机验收前的初版，付费登录、完整图片与实体折叠需在手机上验证。

## 构建

需要 JDK 21、Android SDK platform 35 / build-tools 35.0.0。运行 `./build.sh`；设置 `ANDROID_HOME` / `JAVA_HOME` 可覆盖默认路径。无需 Gradle 或第三方 Android 依赖。

首次构建生成独立本机签名密钥，位于 `~/Library/Application Support/CaixinReader/android-signing`。请自行备份此目录以便后续覆盖升级；不要分享密钥或密码。输出 APK 不可调试，只声明联网权限。

UI 测试：在项目根目录运行 `node android/tests/ui-test.mjs`，使用项目 Playwright 和本机 Chrome。测试使用合成文字，验证响应式布局与段落连续性；测试数据不进入 APK。

详细范围和未验收项目见 `docs/VIVO Fold 5 财新网阅读器需求说明书.md`。

## 1.0.1 修复

移除登录页顶部覆盖横幅，底部提供独立返回按钮。通过缩短网页视图高度预留按钮栏空间，不再使用 WebView padding 避让；官网顶部登录入口完整显示。同签名覆盖安装，无需卸载。

## Android 2.0（四刊版）
最新安装包：dist/weekly-fold-reader-2.0.0.apk，沿用旧包名与签名，支持覆盖安装。
四刊官方账号在应用内分别登录；不需要 PC 在线。最近100期缓存、目录本地优先与异步更新、15配色、三种阅读模式及原文入口已移植。
具体行为和验证边界见 docs/安卓2.0升级说明.md。定期同步在应用运行时执行，系统关闭应用后下次打开续传。
