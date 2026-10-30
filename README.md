# 全澄扫描王

离线文档扫描 App（Android + 网页）。拍一张照片，自动找纸张四角、拉正、增强，**离线识别中英文**，导出可搜索 PDF / 可编辑 Word / TXT。

不联网、不上传、没有会员、没有水印。

## 下载安装

**安卓 APK（最新）**：到 [Releases](https://github.com/Yxiansheng1/quancheng-scanner/releases/latest) 下载 `app-debug.apk`，手机点开安装，允许「安装未知来源应用」。

- 体积约 32MB，支持 arm64 / armv7（覆盖 2015 年之后的绝大多数安卓机）
- 最低系统版本 Android 7.0（API 24）
- debug 签名，够自己用；要上架商店需要另配 release 签名

## 使用

1. 点「添加页面」→ 拍照或从相册选（可一次选多张）
2. 拖动四个蓝点，框住纸张四角（会自动先猜一次，右下角有实时预览）
3. 选画质：**原色** / **增强**（灰度，适合文字）/ **黑白**（像复印件）
4. 重复添加更多页
5. 点「导出」，选：
   - **PDF** — 图片版，样子不变，适合存档打印
   - **Word** — 手机本地识别文字，生成可编辑 docx（按页分页、字号还原）
   - **TXT** — 纯文字

页面存在手机本地（IndexedDB），刷新、关掉都不会丢。

## 为什么导出 PDF 不够

PDF 里的字是图片，改不了、搜不到。要**能改**就必须有文字层，所以有了 Word/TXT 导出。

代价是识别会认错字（尤其手写、拍照歪、反光、公章遮挡）。重要文件（金额、身份证号、合同条款）必须对着原图校对一遍再签。

## 网页版

同一份代码也能当网页用（无 OCR 之外的差异）：

```bash
npm run build      # 打包到 www/
npm run serve      # 起本地服务器，会打印手机可访问的局域网地址
```

手机连同一 WiFi 打开那个地址即可。网页版用的是 Tesseract.js（离线 WASM），中文准确率不如 App 里的 ML Kit。

## 命令

```bash
npm run build                        # 打包网页资源到 www/
npm run sync                         # build + 同步到安卓工程
npm test                             # 扫描算法自测（找边/拉正/增强/PDF，20 项）
node scanner-pwa/tools/test-docx.mjs # DOCX 生成器自测（20 项）
node scanner-pwa/tools/check-pdf.mjs <文件.pdf>  # 校验 PDF 结构
```

## 目录

```
scanner-pwa/          网页内核（纯 JS，零框架）
  scan.js               核心算法：找纸张、四点透视拉正、裁边、增强
  pdf.js                手写 PDF 生成器（JPEG 直嵌，不重编码）
  docx.js               手写 DOCX 生成器（手写 ZIP + OOXML，零依赖）
  ocr.js                网页端 OCR（Tesseract.js，离线 WASM）
  native.js             只有 App 里才加载：ML Kit 识别、系统分享
  app.js                交互逻辑
  idb.js                IndexedDB 本地存档
  vendor/               OCR 模型和 wasm（离线，打包进 APK）
  tools/                自测脚本、图标生成、测试素材
scripts/
  build.mjs             esbuild 打包（App 里不认裸模块名）
  serve.mjs             本地预览服务器
android/               Capacitor 生成的原生工程
ocr-batch/             电脑端批量 OCR（Python + RapidOCR，另一条路线）
www/                   构建产物（不要手改）
```

## 技术实现

**扫描算法**（`scan.js`，自己写的，没用 OpenCV）：
1. 缩到 320px → 灰度 → Otsu 二值化（纸比桌面亮还是暗，自动判断）
2. 最大连通域 = 纸张 → 四方向极值点 = 四角
3. 单应矩阵四点透视变换 → 拉成正面矩形
4. 裁掉边缘带进来的桌面暗边
5. 增强：亮度拉伸 / 灰度 / 二值化

**PDF**（`pdf.js`）：手写对象拼装 + 交叉引用表，JPEG 走 `DCTDecode` 直嵌，不重新编码，画质不掉。

**Word**（`docx.js`）：`.docx` 是 ZIP + XML，手写 ZIP（stored，不压缩）和 OOXML，按行高推算字号，零第三方依赖。

**OCR**：App 里用 Google ML Kit 中文模型（离线、快、准）；网页里用 Tesseract.js（离线 WASM，稍慢）。

**打包**：`scripts/build.mjs` 用 esbuild 把 JS 打成单文件——WebView 里不认识 `@capacitor/filesystem` 这种裸模块名。

## 已知限制

- **没有实时取景框**：拍完再调边框。实时框纸张要开摄像头视频流，安卓 WebView 兼容性坑多，先没做。
- **自动找边会失手**：白纸放白桌、强反光、纸被裁掉一角时可能猜错，手动拖四角能救。
- **Word 只有文字**：字号和分页还原了，缩进、表格、加粗、图片位置都没有。
- **表格会散**：没有版面分析，表格拆成文字行，转不了 Excel。
- **竖排、手写、艺术字、印章** 基本认不出。
- **HEIC 可能读不出来**：从相册选的老照片偶尔是 HEIC。
- **一次几十页会很慢**：手机上一页识别约 1～3 秒，几十页请用 `ocr-batch/` 在电脑上跑。

## 构建环境

- Node 20+
- 云端打包：推代码到 `main`，GitHub Actions 自动编译并发布到 Releases（见 `.github/workflows/android.yml`）
- 本机打包：需要 JDK 17+ 和 Android SDK，然后 `./build-apk.sh`
