#!/usr/bin/env python3
# ============================================================
# push-mock.py - 本地模拟相机 8080 httpd 的 push-cgi, 供 push.sh
# 端到端冒烟测试(不出真机)。用法:
#   python push-mock.py <ROOT目录> [端口, 默认8080]
# 然后:  ./push.sh 127.0.0.1:<端口>
# 文件会写入 <ROOT目录>/nx-rc/web_root/... 与相机端布局一致。
# ============================================================
import json
import os
import sys
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

ROOT = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else ".")
PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 8080
PREFIX = "nx-rc/web_root/"


def resp_ok_json(handler, obj):
    body = json.dumps(obj, separators=(",", ":")).encode()
    handler.send_response(200)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _dispatch(self):
        q = urlparse(self.path)
        params = parse_qs(q.query)
        path = (params.get("path") or [""])[0]
        action = (params.get("action") or [""])[0]

        if action in ("ping", "apply"):
            resp_ok_json(self, {"ok": True, "action": action})
            return
        if not path.startswith(PREFIX) or ".." in path or "//" in path:
            resp_ok_json(self, {"ok": False, "error": f"forbidden path: {path}"})
            return

        target = os.path.join(ROOT, *path.split("/"))
        os.makedirs(os.path.dirname(target), exist_ok=True)
        length = int(self.headers.get("Content-Length") or 0)
        data = self.rfile.read(length) if length else b""
        if not data:
            resp_ok_json(self, {"ok": False, "error": "empty body"})
            return
        tmp = target + ".part"
        with open(tmp, "wb") as f:
            f.write(data)
        os.replace(tmp, target)
        resp_ok_json(self, {"ok": True, "path": path, "bytes": len(data)})

    do_GET = _dispatch
    do_POST = _dispatch


if __name__ == "__main__":
    print(f"push-mock: ROOT={ROOT} PORT={PORT}")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
