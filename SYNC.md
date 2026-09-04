# NX-KS2 安装与同步指南 (Install & Sync Guide)

> 本文件解决一个核心困惑：**固件装在相机内部，SD 卡只是"安装/同步介质"。**
> This file answers one core question: the mod runs from the **camera's internal
> storage** (`/opt/usr/nx-ks/`), the SD card is only a *media* for install/sync.

---

## 0. 为什么 SD 卡上"看不见文件"？(Why is the SD card empty after install?)

- 相机运行的是内部 flash 的副本：`/opt/usr/nx-ks/`（由安装脚本从 SD 复制过去）。
- 旧版 `install.sh` 安装完成后会 **删除 SD 卡上所有安装文件**（防重复触发/防误卸载）。
- 因此"拔卡 → 改 SD 上文件 → 插卡 → 生效"这条路**从来不存在**；存在的是下面的触发链。

**The camera executes `/opt/usr/nx-ks/` (a copy made from the SD card).**
Legacy `install.sh` wiped the SD card after install, so editing files on the SD
card never affected the camera directly.

**触发链 (trigger chain, 相机固件行为, 不可改):**
```
SD 卡根 info.tg
  └─> nx_cs.adj        (内容固定为: shell script /mnt/mmc/install.sh)
        └─> dfmsd 自动执行 /mnt/mmc/install.sh   ← 无需任何按键
```
Putting `info.tg` + `nx_cs.adj` + the **new** `install.sh` on the SD card root is
all it takes to make the camera auto-run the installer/syncer again.

---

## 1. 全量安装（首次装机 / First-time install）

把以下内容放进 SD 卡，插入相机会自动安装（弹窗提示，无需按键）：

```
SD 卡根:
  info.tg  nx_cs.adj  install.sh      ← 仓库根目录这三个文件（最新版）
  NX-KS2_readme.odt                  （可选）
  scripts/                            ← 整个 scripts 目录（仓库里的完整版）
```

- 适用固件: NX500 1.12 / NX1 1.41（其它版本会弹"固件版本不支持"）。
- 安装完成后相机自动重启，SD 卡上的 `scripts/` **保留**，仅清理 3 个触发文件。

---

## 2. 日常增量同步（已装机器 / Update an installed camera）

> **只要已装过一次，以后永远走这条，绝不会误卸载。**
> New `install.sh` is a *safe dispatcher*: already installed ⇒ **incremental sync only**.
> It never touches the bluetoothd hook and never deletes anything on the camera.
> To uninstall, use the camera-menu `uninstall.sh` (asks for confirmation).

每次更新三步走（3 steps per update）:

1. **电脑**：把仓库最新的 `scripts/` 拷进 SD 卡；同时把 `info.tg`、`nx_cs.adj`、
   最新版 `install.sh` 拷到 SD 卡根。
2. **插卡**：相机自动检测 → 增量同步 → 屏幕弹 `[ 同步完成 ]` → 自动重启。
3. **拔卡**。完事。

原理: 引导器检测到已装（`/usr/sbin/bluetoothd.orig` 存在）就走"只覆盖不删除"的
`cp -ar /mnt/mmc/scripts/* /opt/usr/nx-ks/`，把相机内部副本整体更新为 SD 母本。

> 旧版"二象性" install.sh（装过再跑=卸载）**已废弃**。如果你的 SD 卡上还是旧版，
> 请务必换成仓库根目录这份新版，否则插卡会进入卸载分支。
>
> ⚠️ The legacy two-sided install.sh (re-run = uninstall) is **retired**. Always use
> the version from this repo's root.

---

## 3. WiFi 在线推送（日常改前端免拔卡 / Push updates over WiFi）

改了 `web_root` 里的 html/css/js（比如相册前端），不想拔 SD 卡时用这个。
**注意：`push/` 模块需要先经一次 SD 同步装入相机**（第 2 节流程会自动带上）。

相机端（已随同步装入）:
- `push-cgi` → 8080 httpd 的 cgi-bin（与缩略图共用 busybox httpd）
- 8080 httpd 在 nx-rc（web 遥控）启动时自动拉起
- 只允许写入 `nx-rc/web_root/` 前缀内的文件（禁路径穿越），无法触碰系统/二进制

PC 端（Git Bash / Linux / macOS 均可）:
```bash
scripts/nx-rc/push/push.sh <相机IP>              # 推送整个 web_root
scripts/nx-rc/push/push.sh <相机IP> js/gallery.js css/style.css   # 只推几个
```
推完会自动重启相机 web daemon；浏览器硬刷新一次（Ctrl+F5）即可。
之后更新因为 `index.html` 带 `?v=` 版本号，js/css 缓存自动失效，无需再手动清。

联调提示: 相机屏幕的 `rc: <IP>` 就是 IP。也可先 curl 验证:
```bash
curl "http://<IP>:8080/cgi-bin/push?action=ping"    # 期望 {"ok":true,"action":"ping"}
```

---

## 4. 回滚 / 卸载 (Rollback / Uninstall)

- **模块卸载**: 相机上从 mod 菜单运行 `uninstall.sh`（弹窗确认后清空
  `/opt/usr/nx-ks/` 并还原 bluetoothd）。SD 引导器永不触发卸载。
- **版本回退**: 用旧版 `scripts/` 走一次第 2 节同步即可整体回退。

---

## 5. 文件地图 (File map)

| 文件 | 用途 | 部署位置 |
|---|---|---|
| `install.sh` (根) | 智能引导器: 全量安装 / 增量同步 | SD 卡根（触发执行） |
| `info.tg` `nx_cs.adj` | 触发文件（内容固定，勿改） | SD 卡根 |
| `scripts/` | 全部模块母本 | SD 卡 → `/opt/usr/nx-ks/` |
| `scripts/nx-rc.sh` | web 遥控启动（顺带拉起 8080 httpd） | `/opt/usr/nx-ks/` |
| `scripts/update_nxrc.sh` | 只更新 nx-rc 模块（telnet 场景用） | SD 卡 → 相机执行 |
| `scripts/nx-rc/push/push.sh` | PC 端 WiFi 推送 | 只在电脑上跑 |
| `scripts/nx-rc/push/push-cgi` | WiFi 推送接收端 | `/opt/usr/nx-ks/capdtm/www/cgi-bin/push` |
| `scripts/nx-rc/push/push-install.sh` | 安装 push-cgi（幂等） | 相机内执行 |
| `scripts/uninstall.sh` | 手动卸载（弹窗确认） | 相机菜单 |
