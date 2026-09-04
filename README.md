# NX-KS2

Samsung NX500 / NX1 (Tizen / DRIMe5) 增强固件 mod —— 基于社区
[nx500_nx1_modding](https://github.com/SamsungNX500/nx500_nx1_modding) 上游改造与扩展。

> An enhancement mod for the Samsung NX500 / NX1, built on the community
> `nx500_nx1_modding` upstream.

**分支说明 / Branches**: `master` = 上游原始历史(勿动)；**`nx-ks2` = 本项目源码(本文档所在分支)**。

## 特性亮点 / Highlights

- Web 遥控 (`nx-rc`) 网页相册：**折叠目录模型** —— 目录倒序、默认只展开最新目录、
  按需加载 + 缩略图缓存，根治单核 CPU 上目录多导致的首屏卡顿。
- 相机端缩略图 CGI（ImageMagick DCT 缩放 + SD 缓存 + `nice` 降权），前端心跳去抖 +
  并发限流，WiFi 假断开根治。
- 拍摄参数 Web API（`capdtm`）、键位/码率/黑场等原 NX-KS 模块保留。
- 全新**同步链路**：SD 卡"智能引导器"插卡即增量同步（永不误卸载）+ WiFi 在线 push。

## 快速开始 / Quick start

把以下文件放 SD 卡根目录，插入相机即自动执行（相机固件触发链，
`info.tg` → `nx_cs.adj` → 自动运行 `install.sh`）：

```
info.tg  nx_cs.adj  install.sh   <- 仓库根(智能引导器: 未装=全量安装, 已装=增量同步)
scripts/                          <- 整个目录(模块母本, 会被同步到相机内部)
```

- 支持固件：NX500 **1.12** / NX1 **1.41**（其它版本会拒绝）。
- **已装过后再插卡 = 增量同步**，只覆盖不删除、永不卸载；SD 上 `scripts/` 母本保留。
- 卸载请用相机菜单里的 `uninstall.sh`。

## 日常更新两条路 / Daily updates

| 方式 | 命令 / 操作 | 适用 |
|---|---|---|
| SD 智能引导器 | 最新 `scripts/` + `info.tg`/`nx_cs.adj`/`install.sh` 拷进 SD → 插卡自动同步 | 大版本 / 新增模块 |
| WiFi push | `scripts/nx-rc/push/push.sh <相机IP>` | 只改 web 前端时，免拔卡 |

详见 [SYNC.md](SYNC.md)（中英双语安装/同步/回滚指南）。

## 目录结构 / Layout

| 路径 | 说明 |
|---|---|
| `install.sh` `info.tg` `nx_cs.adj` | SD 卡根触发三件套（装机/同步入口） |
| `scripts/` | 全部模块母本，同步目标 = 相机内部 `/opt/usr/nx-ks/` |
| `scripts/nx-rc/` | Web 遥控：`web_root/`(前端)、`thumb/`(缩略图)、`capdtm/`(参数API)、`push/`(WiFi同步) |
| `scripts/update_nxrc.sh` | 只更新 nx-rc 模块的增量脚本（相机端） |
| `test_server/` | PC 端开发/验证环境（模拟相机 API + playwright 用例） |
| `backup_original/` | 原厂文件备份（不入库上传） |

## 文档 / Docs

- `SYNC.md` — 安装 / 增量同步 / WiFi push / 回滚（双语）
- `scripts/nx-rc/thumb/README.md` — 缩略图模块部署（双语）
- `scripts/nx-rc/push/README.md` — WiFi push 用法（双语）

> 胶片仿真探索（recipe + .cube LUT + capdtm ISP）在独立仓库
> [nx500-filmsim](https://github.com/WApaperplane/nx500-filmsim)。
