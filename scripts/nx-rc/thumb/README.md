# NX Web 相册缩略图方案 — 部署指南
# NX Web Gallery Thumbnail System — Deployment Guide

> 中英双语 | Bilingual (zh-CN / EN)
> 本方案解决 NX web 相册"缩略图直接加载原图"导致的卡顿与浏览器内存崩溃。
> This system fixes the NX web gallery "thumbnail = full-res image" problem that
> caused lag and browser OOM when browsing many photos.

---

## 1. 方案概述 / Overview

**问题 / Problem**：`nx-rc/web_root/js/gallery.js` 相册网格原以原图 URL 作缩略图
（CSS 裁切显示）。NX500 单张 JPG 4–8MB，WiFi 直连下滚动几十张即卡顿、崩溃。

**方案 / Solution**（两段式，前端 B + 相机端 A）：

| 层 / Layer | 做法 / Approach |
|---|---|
| 前端 / Frontend (B) | 缩略图改请求相机端 CGI；分批渲染（30 张/批）；IntersectionObserver 视口加载/释放内存 |
| 相机端 / Camera (A) | 新增 `thumb-cgi`（busybox httpd CGI），用内置 ImageMagick `convert` 生成小图并缓存 SD 卡 |

效果：单张缩略图 4–8MB → 15–30KB（约 200 倍），长列表 DOM 与解码内存均受控。

---

## 2. 文件清单 / File Inventory

| 本地路径 (Local) | 相机端路径 (Camera) | 说明 (Purpose) |
|---|---|---|
| `scripts/nx-rc/web_root/js/gallery.js` | `/opt/usr/nx-ks/nx-rc/web_root/js/gallery.js` | 前端相册（核心：分批渲染 + 视口释放 + 请求限流 + 流式加载） |
| `scripts/nx-rc/web_root/css/style.css` | `/opt/usr/nx-ks/nx-rc/web_root/css/style.css` | 相册样式 + 页面滚动修复 |
| `scripts/nx-rc/thumb/thumb-cgi` | `/opt/usr/nx-ks/nx-rc/thumb/thumb-cgi` | 缩略图生成 CGI（源） |
| `scripts/nx-rc/thumb/thumb-install.sh` | `/opt/usr/nx-ks/nx-rc/thumb/thumb-install.sh` | 安装脚本 |
| `scripts/nx-rc/thumb/thumb-prewarm.sh` | `/opt/usr/nx-ks/nx-rc/thumb/thumb-prewarm.sh` | 后台预生成缓存（解决首屏慢） |
| `scripts/nx-rc/web_root/js/controller.js` | `/opt/usr/nx-ks/nx-rc/web_root/js/controller.js` | 心跳去抖（解决“假断开”） |
| `scripts/nx-rc/web_root/js/app.js` | `/opt/usr/nx-ks/nx-rc/web_root/js/app.js` | 页签切换时重排心跳 |
| `scripts/nx-rc/thumb/README.md` | `/opt/usr/nx-ks/nx-rc/thumb/README.md` | 本文档 |
| —（安装时复制） | `/opt/usr/nx-ks/capdtm/www/cgi-bin/thumb` | CGI 实际部署位置 |
| `test_server/server.py` | —（仅 PC） | PC 模拟相机（含 `/cgi-bin/thumb`） |

相机端 `tools/`（`/opt/usr/nx-ks/tools/usr/bin/convert` + `tools/usr/lib`）与
`capdtm` 模块（8080 busybox httpd）为既有依赖，NX-KS 完整包已内置。

---

## 3. 相机端部署 / On-Camera Deployment

### 3.1 前置条件 / Prerequisites

- 已安装 NX-KS mod（root 权限），固件 NX500 1.12 或 NX1 1.41
- `/opt/usr/nx-ks/tools/usr/bin/convert` 存在（NX-KS 完整包自带）
- `/opt/usr/nx-ks/capdtm/` 存在（capdtm 模块，提供 8080 httpd）

### 3.2 拷贝文件 / Copy Files

将本仓库 `scripts/` 目录放入 SD 卡根目录，开机执行 `install.sh`
（自动复制到 `/opt/usr/nx-ks/`）；或手动复制：

```sh
# 在相机端(已有 root)执行
cp -ar /mnt/mmc/scripts/nx-rc/web_root/js/gallery.js  /opt/usr/nx-ks/nx-rc/web_root/js/gallery.js
cp -ar /mnt/mmc/scripts/nx-rc/web_root/css/style.css /opt/usr/nx-ks/nx-rc/web_root/css/style.css
cp -ar /mnt/mmc/scripts/nx-rc/thumb                   /opt/usr/nx-ks/nx-rc/thumb
```

### 3.3 安装缩略图 CGI / Install Thumb CGI

```sh
/opt/usr/nx-ks/nx-rc/thumb/thumb-install.sh start
```

该脚本做两件事：
1. 复制 `thumb-cgi` 到 `/opt/usr/nx-ks/capdtm/www/cgi-bin/thumb` 并 `chmod +x`
2. `start` 参数下确保 8080 busybox httpd 运行（调用 `capdtm-httpd.sh start`）

安装后立即验证端点（相机 IP 以实际为准）：

```sh
curl "http://<相机IP>:8080/cgi-bin/thumb?f=100PHOTO/IMG_0001.JPG&w=400&q=82" -o /tmp/t.jpg && ls -la /tmp/t.jpg
# 预期: 返回 15-30KB 的 JPEG(Content-Type: image/jpeg)
```

### 3.4 开机自启 / Auto-start on Boot

在开机脚本 `auto/a_init.sh` 末尾追加：

```sh
/opt/usr/nx-ks/nx-rc/thumb/thumb-install.sh start &
```

### 3.5 预热缓存（强烈建议）/ Pre-warm Cache (Recommended)

首次浏览时相机要现场跑 `convert`（0.5–2s/张），几百张照片首屏很慢，
且 CPU 打满会拖慢遥控心跳。用预热脚本在后台提前铺好缓存：

```sh
# 预热最新 300 张（400px / q82），最低优先级运行，不影响拍摄
/opt/usr/nx-ks/nx-rc/thumb/thumb-prewarm.sh start 400 82 300

# 查看进度
/opt/usr/nx-ks/nx-rc/thumb/thumb-prewarm.sh status

# 停止
/opt/usr/nx-ks/nx-rc/thumb/thumb-prewarm.sh stop
```

- 缓存路径与 CGI 完全一致，预热后浏览直接命中缓存（秒开）
- 按「目录倒序 + 文件名倒序」处理，最新照片优先
- 已缓存且未过期的自动跳过，可反复执行
- 开机自启（追加到 `auto/a_init.sh`）：`.../thumb-prewarm.sh start &`

### 3.6 端到端验证 / End-to-end Verification

1. 相机开启 WiFi，浏览器访问 `http://<相机IP>/`
2. 顶部导航切到「相册」
3. 预期：
   - 缩略图快速出现（每张 15–30KB；首次访问逐张生成，0.5–2s/张，之后秒开）
   - 滚动到底自动加载下一批（每批 30 张），直至「已加载全部 N 个文件」
   - 点击缩略图，Lightbox 以原图打开
   - 开发者工具 Network：缩略图请求全部指向 `:8080/cgi-bin/thumb`，无原图直连

---

## 4. PC 端联调测试 / PC-side Test

不改相机端即可在 PC 上验证前端（`test_server` 模拟相机行为）。

```sh
# 1. 准备 Python 环境(仅需 Pillow)
C:/Users/31623/.workbuddy/binaries/python/envs/default/Scripts/python.exe -m pip install Pillow

# 2. 启动模拟相机(默认 8080 端口)
cd test_server
<venv-python> server.py 8080

# 3. 浏览器打开
open http://127.0.0.1:8080/    # 相册 tab 即完整缩略图流程

# 4. 自动化验证(可选,需 Edge + playwright-core)
cd test_server
NODE_PATH=<node-workspace>/node_modules node verify-gallery.js
```

说明：
- `test_server/server.py` 的 `/cgi-bin/thumb` 用 Pillow 生成缩略图，
  行为与相机端 `thumb-cgi` 一致（含 EXIF 方向处理、参数钳制、路径安全校验）
- `verify-gallery.js` 自动检查：首批 30 张、滚动分批加载至全部、
  缩略图 100% 走 CGI、视口内存释放、Lightbox 原图

---

## 5. 配置 / Configuration

前端 `gallery.js` 顶部：

```js
Gallery.THUMB = {
    enabled: true,   // 相机端未部署 CGI 时置 false,退回原图加载
    port: 8080,      // busybox httpd 端口(与 capdtm-httpd.sh 一致)
    width: 400,      // 缩略图长边像素(网格 140px @2x DPR 足够)
    quality: 82
};
```

CGI 参数：`f`（DCIM 相对路径，必需）、`w`（64–1024，默认 400）、
`q`（50–95，默认 82）。越界值自动钳制；`f` 做路径穿越/扩展名白名单校验。

缓存：SD 卡 `.thumbcache/<宽>x<质量>/<原路径>.jpg`，源文件 mtime 变化自动重建；
清空缓存：`rm -rf /mnt/mmc/.thumbcache`。

---

## 6. 故障排查 / Troubleshooting

| 现象 / Symptom | 原因 / Cause | 处理 / Fix |
|---|---|---|
| 缩略图显示占位图标 | 8080 httpd 未启动 | `capdtm-httpd.sh start` 或 `thumb-install.sh start` |
| 缩略图全部回退原图（慢但可用） | CGI 未部署 / 返回错误 | 检查 `/opt/usr/nx-ks/capdtm/www/cgi-bin/thumb` 存在且可执行；用 curl 直测端点 |
| `thumb error: convert not found` | tools 未部署或路径不对 | 确认 `/opt/usr/nx-ks/tools/usr/bin/convert` 存在；thumb-cgi 内路径为写死的 `/opt/usr/nx-ks/tools` |
| `thumb error: SD card not found` | SD 挂载点非预期 | thumb-cgi 自动探测 `/mnt/mmc /tmp/mmc /mnt/sd /tmp/sd`；确认真实挂载点 |
| 首次浏览逐张生成太慢 | 缓存未建立 | 运行 `thumb-prewarm.sh start` 后台预热（见 3.5），之后秒开 |
| **弹「相机已断开」，但点掉后图片照常加载** | 相机 CPU 被 `convert` 打满，80 端口心跳被饿死超时 → 旧逻辑单次失败即弹窗（假阳性） | 已修复：连续 3 次失败才判定断开，超时放宽到 8s，相册页心跳降到 6s 一次，未达阈值只显示底部轻量提示条。确认 `controller.js` 已更新 |
| 底部常驻「相机响应缓慢」提示 | 相机确实繁忙（预热或首次生成中） | 属正常提示，任务完成后自动消失；若长期不消失再查网络 |
| 相机重启后缓存丢失 | —（SD 卡缓存不会丢） | 若使用 `/tmp` 才丢失；确认缓存目录在 `/mnt/mmc/.thumbcache` |
| 页面无法滚动 | 旧 CSS 高度锁死 | 确认已更新 `style.css`（`body,html` 为 `min-height:100%; height:auto; overflow-y:auto`） |

---

## 7. 回滚 / Rollback

```sh
# 1. 停用缩略图:前端退回原图加载(一行)
#    编辑 /opt/usr/nx-ks/nx-rc/web_root/js/gallery.js, 将 Gallery.THUMB.enabled 置 false

# 2. 移除 CGI
rm /opt/usr/nx-ks/capdtm/www/cgi-bin/thumb

# 3. 恢复前端旧文件(如备份)
cp /mnt/mmc/backup_original/nx-rc/web_root/js/gallery.js /opt/usr/nx-ks/nx-rc/web_root/js/gallery.js

# 4. 清理缩略图缓存
rm -rf /mnt/mmc/.thumbcache
```

---

## 8. 已知限制 / Known Limitations

- 视频项无缩略图，维持播放占位符（convert 不支持视频帧提取）
- 竖拍照片依赖 EXIF orientation（`-auto-orient` 已处理，PC 端对应 `exif_transpose`）
- 仅支持 JPEG/PNG/GIF/BMP/TIFF 图片格式
- 相机端首次生成缩略图占用少量 CPU（每张 0.5–2s），缓存后无感
