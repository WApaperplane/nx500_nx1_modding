# capdtm 相机参数服务(NX-KS2 WiFi 增强)

为 nx-rc Web 界面的「相机设置」页提供拍摄参数读写 API(基于 `st cap capdtm`)。

## 目录结构

```
capdtm/
├── capdtm-cgi.sh           # CGI 主脚本(参数读写逻辑)
├── capdtm-httpd.sh         # busybox httpd 启动脚本(8080 端口)
├── capdtm.conf             # 参数映射表(按固件版本校准)
└── www/cgi-bin/capdtm-api  # 部署到相机后的 CGI 入口(与 capdtm-cgi.sh 相同)
```

## 相机端部署(需要 NX-KS root,SD 卡或 adb/ssh 拷贝)

1. 拷贝整个目录到相机:
   ```
   /opt/usr/nx-ks/capdtm/
   ```
2. 赋予可执行权限:
   ```
   chmod +x /opt/usr/nx-ks/capdtm/capdtm-httpd.sh
   chmod +x /opt/usr/nx-ks/capdtm/capdtm-cgi.sh
   chmod +x /opt/usr/nx-ks/capdtm/www/cgi-bin/capdtm-api
   ```
3. 加入开机自启(编辑 `/opt/usr/nx-ks/auto/a_init.sh`,末尾追加):
   ```
   /opt/usr/nx-ks/capdtm/capdtm-httpd.sh start &
   ```
   或手动启动一次:`/opt/usr/nx-ks/capdtm/capdtm-httpd.sh start`

## 验证

浏览器打开(或 curl):
```
http://<相机IP>:8080/cgi-bin/capdtm-api?action=list
```
应返回 JSON 形式的当前参数值。

## 参数校准(重要)

不同固件版本的 capdtm 参数 ID 存在偏移(NX1 1.11 / NX500 1.12、1.40 各不相同)。
若某参数写入无效或读取为空:

1. 在相机上执行 `st cap capdtm getusr <参数名>` 查看该参数实际输出;
2. 对照 `capdtm.conf`,把每个取值的 hex 填入 `名称=hex` 位置;
3. 重启 httpd 生效。

`capdtm.conf` 中 hex 留空的项,脚本会尝试直接按参数名写入(部分固件支持)。

## 说明

- 8080 端口与 nx-rc 的 80 端口跨源,CGI 已输出 `Access-Control-Allow-Origin: *`;
- 若 busybox httpd 不支持 CGI(busybox 编译时未启用),可改用方案 B:
  把 `capdtm-api` 复制到 nx-rc 的 `web_root/cgi-bin/` 下,由 daemon(Mongoose)
  直接执行(需 daemon 开启 CGI,固件字符串中可见 `**.cgi$` 规则,实机验证)。
