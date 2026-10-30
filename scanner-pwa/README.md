# 扫描 · 离线文档扫描（PWA）

自己用的文档扫描工具。拍一张照片，自动找出纸张四角、拉正、增强，最后拼成 PDF。
全部在本地跑，不上传、不联网、没有会员、没有水印。

**为什么是网页而不是原生 App**：iPhone 装原生 App 需要 Mac + Xcode 编译，装到真机还要 Apple ID 签名（免费签名 7 天过期），上架要 $99/年。做成网页版后，iPhone 用 Safari 打开 →「添加到主屏幕」，图标和用起来都跟 App 一样，而且 iPhone / 安卓 / 电脑通吃。

## 本地预览

```bash
node tools/serve.mjs          # 然后开 http://localhost:8080
```

## 部署到 iPhone（GitHub Pages，免费）

1. 在 GitHub 新建一个仓库（public，比如 `scanner`）。
2. 把本目录所有文件推上去：

```bash
git init
git add .
git commit -m "扫描 PWA"
git branch -M main
git remote add origin https://github.com/<你的用户名>/scanner.git
git push -u origin main
```

3. 仓库 → Settings → Pages → Source 选 `Deploy from a branch`，分支选 `main`、目录选 `/ (root)`，保存。
4. 等一分钟，访问 `https://<你的用户名>.github.io/scanner/`。
5. iPhone Safari 打开这个地址 → 分享按钮 →「添加到主屏幕」。

> 必须是 https 才能用相机和本地缓存，GitHub Pages 自带 https，正好。

## 用起来

- **添加页面**：点按钮，iOS 会弹出「拍照 / 照片图库」——可以一次选多张，会逐张进入编辑。
- **调整边框**：蓝框四个角可以拖，拖到纸张的四个角上。右下角有实时预览。
  - 「重新识别」= 让算法再猜一次
- **原色 / 增强 / 黑白**：增强是灰度+拉伸对比度，最适合文字；黑白是二值化，最像复印件。
- **导出 PDF**：一次把所有页拼成一个 PDF。iOS 上会弹系统分享（存到文件 / 发微信 / 打印都行）。
- 页面存在浏览器本地（IndexedDB），刷新、关掉都不会丢；「清空」才删。

## 命令

```bash
node tools/test.mjs                      # 算法自测（找边/拉正/增强/PDF 结构，20 项）
node tools/check-pdf.mjs <文件.pdf>       # 单独校验一个 PDF 的结构
node tools/make-icons.cjs                # 重新生成图标
node tools/make-sample.cjs               # 生成一张测试用的“文档照片”
```

本地联调技巧：`http://localhost` 下不会注册 Service Worker，改了代码刷新就是最新的；
部署到线上后才有离线缓存，届时改动记得改 `sw.js` 里的 `CACHE` 版本号，否则老用户会一直读到旧文件。

## 目录

| 文件 | 干什么 |
|---|---|
| `index.html` / `styles.css` | 界面（三个屏：首页 / 编辑 / 查看） |
| `app.js` | 交互、页面管理、导出流程 |
| `scan.js` | **核心算法**：找纸张轮廓、四点透视拉正、裁边、增强。纯函数，不依赖浏览器，可直接在 Node 里测 |
| `pdf.js` | 极简 PDF 生成器，把 JPEG 直接嵌进 PDF（DCTDecode），无第三方依赖 |
| `idb.js` | IndexedDB 存取，保证刷新不丢 |
| `sw.js` / `manifest.webmanifest` | 离线缓存 + 加到主屏幕所需的元信息 |

## 算法大概怎么做的

1. 缩到 320px 宽，转灰度，做 Otsu 二值化（纸是亮的还是暗的会自动判断）。
2. 找最大的连通区域 = 纸张；取它在四个方向上的极值点当四角。
3. 四点透视变换（单应矩阵）把纸面拉成正面矩形。
4. 把边缘可能带进来的桌面暗边裁掉。
5. 增强：亮度拉伸 / 灰度 / 二值化。

## 已知限制

- **没有实时取景框**：现在是拍完再调边框。要实时框住纸张得开摄像头视频流，iOS 上体验不稳定，先没做。
- **自动找边会失手**：白纸放在白色桌面、纸张被裁掉一角、强反光时可能猜错，手动拖四角即可。
- **HEIC 可能读不出来**：iPhone 用「拍照」给的是 JPEG，从相册选老照片偶尔是 HEIC，读不出会提示。
- **没有 OCR**：不识别文字、PDF 里搜不到字。要加的话可以接 Tesseract.js（体积大、慢）或自己写后端调 PaddleOCR。
- **没有实时批量**：多选是逐张确认，不是一键处理。
