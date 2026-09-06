#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""telnet_run.py - 向 NX 相机 telnetd 发送命令并收集输出(非交互,过滤 IAC 协商字节)

用法: python telnet_run.py '命令1' '命令2' ...
登录: 自动发 root;密码从环境变量 NX_TELNET_PWD 读取(默认空)
"""
import socket, sys, time, os, re

HOST, PORT = os.environ.get("NX_TELNET_HOST", "192.168.0.103"), 23
# 第一个参数若是 IP 则作为目标主机(相机 DHCP 后 IP 会变)
cmds = sys.argv[1:]
if cmds and re.match(r'^\d+\.\d+\.\d+\.\d+$', cmds[0]):
    HOST = cmds.pop(0)
if not cmds:
    print("用法: python telnet_run.py [IP] '命令1' '命令2' ...")
    sys.exit(1)

s = socket.create_connection((HOST, PORT), timeout=8)
s.settimeout(2)

def drain(t=1.5):
    end = time.time() + t
    out = b""
    while time.time() < end:
        try:
            chunk = s.recv(4096)
            if not chunk:
                break
            out += chunk
        except socket.timeout:
            pass
    clean = bytearray()
    i = 0
    while i < len(out):
        if out[i] == 0xFF and i + 2 < len(out):
            i += 3
            continue
        clean.append(out[i])
        i += 1
    return clean.decode("utf-8", errors="replace")

first = drain(2.0)
if "login:" in first:
    s.sendall(b"root\n")
    time.sleep(0.5)
    second = drain(2.0)
    if "assword" in second:
        pwd = os.environ.get("NX_TELNET_PWD", "")
        s.sendall((pwd + "\n").encode())
        drain(2.0)

for c in cmds:
    s.sendall((c + "\n").encode())
    time.sleep(0.3)
    print("$ " + c)
    print(drain(2.5))
    print("-" * 60)
s.close()
