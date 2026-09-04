#!/bin/sh
# ============================================================
# push-install.sh - 安装 push-cgi 到 8080 httpd 的 cgi-bin (幂等)
# 用法: push-install.sh
#
# 拷贝本模块的 push-cgi 到 capdtm httpd 的 CGI 目录, 使其可被
# PC 端 push.sh 调用。可重复执行; 建议加入开机链(nx-rc.sh 启动时
# 会自动调用本脚本, 无需手工执行)。
# ============================================================

SELF=$(cd "$(dirname "$0")" && pwd)
NX_KS=/opt/usr/nx-ks
CGI_TARGET=$NX_KS/capdtm/www/cgi-bin/push

# 目标 httpd 目录不存在(capdtm 模块缺失)时给出提示但不中断
if [ ! -d "$NX_KS/capdtm/www/cgi-bin" ]; then
    echo "错误: 未找到 $NX_KS/capdtm/www/cgi-bin(先安装/同步 nx-rc 模块)" >&2
    exit 1
fi

cp -f "$SELF/push-cgi" "$CGI_TARGET"
chmod +x "$CGI_TARGET"
echo "push-cgi 已安装 -> $CGI_TARGET"

# 确保 8080 httpd 在跑(thumb-install.sh start 也会做同样的事)
if [ -x "$NX_KS/capdtm/capdtm-httpd.sh" ]; then
    "$NX_KS/capdtm/capdtm-httpd.sh" start
fi

exit 0
