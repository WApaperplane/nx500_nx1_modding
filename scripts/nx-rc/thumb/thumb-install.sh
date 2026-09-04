#!/bin/sh
# ============================================================
# thumb-install - 安装缩略图 CGI 到 capdtm 的 busybox httpd
# 用法: thumb-install.sh [start]
#   start 参数同时确保 8080 httpd 已启动(相机开机脚本里调用)
#
# 建议加入 NX-KS 开机脚本 auto/a_init.sh 末尾:
#   /opt/usr/nx-ks/nx-rc/thumb/thumb-install.sh start &
# ============================================================

SELF=$(cd "$(dirname "$0")" && pwd)
NX_KS=/opt/usr/nx-ks
CGI_TARGET=$NX_KS/capdtm/www/cgi-bin/thumb

# 拷贝 CGI 到 httpd 的 cgi-bin(thumb 脚本内写死 /opt/usr/nx-ks/tools 路径)
cp -f "$SELF/thumb-cgi" "$CGI_TARGET"
chmod +x "$CGI_TARGET"

# 可选:确保 8080 httpd 运行(依赖 capdtm 模块)
if [ "$1" = "start" ] && [ -x "$NX_KS/capdtm/capdtm-httpd.sh" ]; then
    "$NX_KS/capdtm/capdtm-httpd.sh" start
fi

exit 0
