#!/bin/bash
#
killall -q nx-input-injector
killall -q xev-nx
killall -q nx-remote-controller-daemon
killall -q onscreen_rc
#
export APP_PATH=/opt/usr/nx-ks/nx-rc
# --- nx-rc 附属服务: 8080 httpd(缩略图 CGI / 参数 API / WiFi push 接收) ---
# push-install: 部署 push-cgi 到 capdtm cgi-bin(幂等); thumb-install: 部署
# thumb-cgi 并确保 8080 httpd 启动(带 pid 防重复)。Web 遥控一开即全套可用。
[ -x "$APP_PATH/push/push-install.sh" ]   && "$APP_PATH/push/push-install.sh"   >/dev/null 2>&1
[ -x "$APP_PATH/thumb/thumb-install.sh" ] && "$APP_PATH/thumb/thumb-install.sh" start >/dev/null 2>&1
#
nice --adjustment=19 $APP_PATH/nx-remote-controller-daemon &> /dev/null &
#
showmetheway(){
	while true; do
	IP=`ip addr ls|grep inet|grep mlan0|cut -d/ -f 1|grep -o '[0-9]\{1,3\}\.[0-9]\{1,3\}\.[0-9]\{1,3\}\.[0-9]\{1,3\}'`
	[[ -z $IP ]] && IP="Enable WiFi"
	killall onscreen_rc
	 nice -n +10 /opt/usr/nx-ks/onscreen_rc "rc: $IP" &
	sleep 4
	done
}
showmetheway&
#tothenextwhiskeybar
