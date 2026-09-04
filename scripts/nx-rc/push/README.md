# push - WiFi 在线同步模块 (Online push / sync over WiFi)

把电脑上最新的 web 前端直接写入相机 `/opt/usr/nx-ks/nx-rc/web_root/`，
免拔 SD 卡。**前提：push-cgi 需先经一次 SD 卡同步装入相机**（见仓库根 SYNC.md 第 2 节）。

## PC 端用法 (from your PC, Git Bash/Linux/macOS)

```bash
push.sh <相机IP>                              # 推整个 web_root
push.sh <相机IP> js/gallery.js css/style.css  # 只推指定文件
push.sh <相机IP>:<端口>                        # 联调时可指定端口(默认8080)
```

推完自动重启相机 web daemon，浏览器硬刷新一次(Ctrl+F5)生效。

## 相机端文件 (on camera, auto-installed by SD sync / nx-rc.sh)

| 文件 | 作用 |
|---|---|
| `push-cgi` | 8080 httpd CGI 接收端 → 部署到 `/opt/usr/nx-ks/capdtm/www/cgi-bin/push` |
| `push-install.sh` | 幂等部署 push-cgi（nx-rc.sh 启动时自动调用） |
| `push.sh` | PC 端推送脚本（只留在电脑上，不必上相机） |

## 协议 (protocol)

```
POST /cgi-bin/push?path=nx-rc/web_root/js/gallery.js   body=文件原样内容
GET  /cgi-bin/push?action=ping     # 在线探测(无副作用)
GET  /cgi-bin/push?action=apply    # 推完重启 web daemon
```

安全：目标路径强制 `nx-rc/web_root/` 前缀 + 禁 `..`，只能覆盖静态页面文件。

## 本地联调 (PC-side smoke test, no camera needed)

`test_server/push-mock.py` 模拟相机端接收，跑完整协议：
```bash
python test_server/push-mock.py /tmp/mockroot 18081
scripts/nx-rc/push/push.sh 127.0.0.1:18081
```

## Notes / 注意事项

- 首次使用建议只推一个文件试水（如 `js/gallery.js`），确认页面正常再全量。
- 若 8080 无响应：确认相机 web 遥控已开启（8080 由 nx-rc.sh 拉起）。
- 大版本改动（新增模块、改 CGI/二进制）仍建议走 SD 卡整包同步。
