# 全澄扫描王

离线文档扫描 App（Android）。拍一张照片，自动找纸张四角、拉正、增强，导出 **可搜索 PDF / 可编辑 Word / TXT**。

全部在本地完成：不联网、不上传、没有会员、没有水印。

## 两种用法，同一份代码

| | 网页版 | 安卓 App |
|---|---|---|
| 装 | 不用装，Safari 打开就�� | APK 安装 |
| 找边 / 拉正 / 增强 | ✅ | ✅（同一份代码） |
| 导出 PDF / TXT | ✅ | ✅ |
| **导出 Word（文字识别）** | ❌ | ✅（ML Kit 中文识别，离线） |

网页版用 `scanner-pwa/` 里的原生 JS，安卓版用 Capacitor 把同一份代码包成 App。

## 快速开始

### 网页版

```bash
npm run serve      # http://localhost:8080
```

### 安卓版（GitHub 云构建，你不用装任何东西）

1. 把代码推到 GitHub 仓库。
2. 仓库 → Settings → Pages → Source 选 `Deploy from a branch`，分支 `main`、目录 `/ (root)`。
   → 网页版就上线了，iPhone 用 Safari 打开 → 分享 →「添加到主屏幕」。
3. 仓库 → Actions → 「构建 Android APK」→ Run workflow。
   → 完成后在 Artifacts 里下载 APK，装到安卓手机上。

### 安卓版（本机构建，需要 JDK 17+ 和 Android SDK）

```bash
./build-apk.sh          # debug
./build-apk.sh release  # release（需自己配签名）
```

## 命令

```bash
npm run build                       # 打包网页资源到 www/
npm run sync                        # build + 同步到安卓工程
npm test                            # 算法自测（找边/拉正/增强/PDF 结构，20 项）
node scanner-pwa/tools/test-docx.mjs  # DOCX 生成器自测（20 项）
node scanner-pwa/tools/check-pdf.mjs <文件.pdf>  # 校验一个 PDF 的结构
```

## 目录

```
scanner-pwa/          网页内核（纯 JS，无框架）
  scan.js               核心算法：找边、四点透视拉正、裁边、增强
  pdf.js                手写 PDF 生成器（JPEG 直嵌，零依赖）
  docx.js               手写 DOCX 生成器（zip + XML，零依赖）
  native.js             只有 App 里才会加载：ML Kit 识别、文件分享
  app.js                交互
  idb.js                IndexedDB 存档
  tools/                自测脚本、图标生成、测试素材
scripts/build.mjs     esbuild 打包（解决 App 里裸模块名的问题）
android/               Capacitor 生成的原生工程
www/                   构建产物（不要手改）
.github/workflows/     云构建 APK
ocr-batch/             电脑端批量 OCR（可选，另一条路线）
```

## 技术要点

**扫描算法**（`scan.js`，自己写的，没用 OpenCV）：
1. 缩到 320px → 灰度 → Otsu 二值化（纸是亮的还是暗的自动判断）
2. 最大连通域 = 纸张 → 四个方向的极值点 = 四角
3. 单应矩阵四点透视变换 → 拉成正面矩形
4. 裁掉带进来的桌面暗边
5. 增强：亮度拉伸 / 灰度 / 二值化

**PDF**（`pdf.js`）：手写对象拼装 + 交叉引用表，JPEG 走 `DCTDecode` 直接嵌，不重新编码，画质不掉。

**Word**（`docx.js`）：`.docx` 是 zip + XML，用 fflate 打包，按 ML Kit 给的行坐标推算字号。

**原生能力**（`native.js`）：只有 `Capacitor.isNativePlatform()` 为真时才动态 import，网页版完全不受影响。

## 已知限制

- **没有实时取景框**：拍完再调边框。实时框纸张需要开摄像头视频流，兼容性坑多，先没做。
- **自动找边会失手**：白纸放白桌、强反光、纸被裁掉一角时可能猜错，手动拖四角能救。
- **Word 只有文字**：字号和分页还原了，缩进/表格/加粗/图片位置没有。
- **表格会散**：没有版面分析，表格会被拆成文字行，转 Excel 做不到。
- **OCR 会认错字**：重要文件（金额、身份证号）必须校对。
- **HEIC 可能读不出来**：从相册选的老照片偶尔是 HEIC。
