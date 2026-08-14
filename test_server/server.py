# -*- coding: utf-8 -*-
"""
本地模拟三星 NX 相机端 Web 服务器(供测试 nx-rc 前端图库用)。
- / 及其它路径:提供 web_root 静态文件(与相机 daemon 一致)
- /DCIM 及子目录:返回 Mongoose "Index of" 格式的目录页(与相机 daemon 输出一致)
"""
import os
import sys
import datetime
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

BASE = os.path.dirname(os.path.abspath(__file__))
# 直接引用真实的前端文件,改动即时生效(测试对象即交付物)
WEB_ROOT = os.path.abspath(os.path.join(BASE, '..', 'scripts', 'nx-rc', 'web_root'))
SDCARD = os.path.join(BASE, 'sdcard')

CONTENT_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.htm': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.avi': 'video/x-msvideo',
}


def human_size(n):
    """模拟 Mongoose 的字节数格式化"""
    n = float(n)
    for unit in ['B', 'K', 'M', 'G']:
        if n < 1024 or unit == 'G':
            if unit == 'B':
                return '%d%s' % (int(n), unit)
            return '%.1f%s' % (n, unit)
        n /= 1024.0
    return '%d%s' % (int(n), 'B')


def index_of_page(path, entries):
    """复刻 Mongoose mg_http_serve_file 的目录列表 HTML"""
    rows = []
    for name, is_dir, size, mtime in entries:
        disp = name + ('/' if is_dir else '')
        link = urllib.parse.quote(disp)
        if is_dir:
            size_txt = '[DIRECTORY]'
            name_attr = 4096
        else:
            size_txt = human_size(size)
            name_attr = size
        mtime_txt = mtime.strftime('%Y-%m-%d %H:%M')
        rows.append(
            '<tr><td><a href="%s">%s</a></td><td>%s</td>'
            '<td name=%d>%s</td></tr>' % (link, disp, mtime_txt, name_attr, size_txt)
        )
    return (
        '<html><head><title>Index of %s</title>'
        '<style>th,td {text-align: left; padding-right: 1em; font-family: monospace; }</style>'
        '</head>\n<body><h1>Index of %s</h1>\n'
        '<table cellpadding=0><thead><tr><th><a href=# rel=0>Name</a></th>'
        '<th><a href=# rel=1>Modified</a></th><th><a href=# rel=2>Size</a></th></tr>'
        '<tr><td colspan=3><hr></td></tr></thead>\n<tbody id=tb>\n%s\n'
        '</tbody><tr><td colspan=3><hr></td></tr>\n</table>\n'
        '<address>NX-KS2 test server</address>\n</body></html>'
    ) % (path, path, '\n'.join(rows))


# 模拟 capdtm 参数表(取值命名与相机端 st cap capdtm getusr 输出一致)
MOCK_CAPDTM = {
    'USERDATA_ISO': 'ISO_AUTO',
    'USERDATA_METERING': 'METERING_MULTI',
    'USERDATA_WB': 'WB_AUTO',
    'USERDATA_IMAGEQUALITY': 'IMAGEQUALITY_FINE',
    'USERDATA_IMAGESIZE': 'IMAGESIZE_NORMAL_28M',
    'USERDATA_IMAGEASPECTRATIO': 'IMAGEASPECTRATIO_IMAGEAR_3_2',
    'USERDATA_PW': 'PW_STANDARD',
    'USERDATA_COLORSPACE': 'COLORSPACE_SRGB',
    'USERDATA_AFMODE': 'AFMODE_SINGLE',
    'USERDATA_DRIVE': 'DRIVE_SINGLE',
}


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def log_message(self, fmt, *args):
        sys.stderr.write('[req] %s\n' % (fmt % args))

    def _send(self, code, ctype, body, extra_headers=None):
        if isinstance(body, str):
            body = body.encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        if extra_headers:
            for k, v in extra_headers:
                self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def do_HEAD(self):
        self.do_GET(head_only=True)

    def do_POST(self):
        # 控制器部分接口用 POST(真实相机 daemon 同样支持),统一走 do_GET 逻辑
        self.do_GET()

    def handle_capdtm(self, parsed):
        """模拟 st cap capdtm 参数读写 API(list / set)"""
        import json
        qs = urllib.parse.parse_qs(parsed.query)
        action = (qs.get('action') or [''])[0]
        cors = [('Access-Control-Allow-Origin', '*')]
        if action == 'list':
            body = json.dumps({'ok': True, 'params': dict(MOCK_CAPDTM)})
            self._send(200, 'application/json; charset=utf-8', body, cors)
            return
        if action == 'set':
            name = (qs.get('name') or [''])[0]
            value = (qs.get('value') or [''])[0]
            if name in MOCK_CAPDTM:
                MOCK_CAPDTM[name] = value
                body = json.dumps({'ok': True, 'name': name, 'value': value})
                self._send(200, 'application/json; charset=utf-8', body, cors)
            else:
                body = json.dumps({'ok': False, 'error': 'unknown param: ' + name})
                self._send(200, 'application/json; charset=utf-8', body, cors)
            return
        body = json.dumps({'ok': False, 'error': 'unknown action'})
        self._send(200, 'application/json; charset=utf-8', body, cors)

    def do_GET(self, head_only=False):
        parsed = urllib.parse.urlparse(self.path)
        path = urllib.parse.unquote(parsed.path)

        # ---- capdtm 参数 API(真实相机由 busybox httpd + CGI 提供,CORS 头) ----
        if path.startswith('/capdtm/api') or path.startswith('/cgi-bin/capdtm-api'):
            self.handle_capdtm(parsed)
            return

        # ---- 相机控制 API 占位(真实相机由 daemon 提供,此处仅消除 404 噪音) ----
        if path.startswith('/api/v1/'):
            if path.startswith('/api/v1/camera/info'):
                self._send(200, 'application/json; charset=utf-8',
                           '{"model":"NX500","mac_address":"00:11:22:33:44:55","fw_ver":"1.42"}')
            elif path.startswith('/api/v1/camera/status'):
                self._send(200, 'application/json; charset=utf-8',
                           '{"cameras":[],"battery_percent":100,"battery_charging":false,'
                           '"battery_level":5,"mode":"P","hevc":"off"}')
            else:
                self._send(200, 'application/json; charset=utf-8', '{}')
            return

        # ---- DCIM 目录请求(相机相册) ----
        if path == '/DCIM' or path.startswith('/DCIM/'):
            rel = path[len('/DCIM'):].strip('/')
            fs = os.path.join(SDCARD, 'DCIM', rel) if rel else os.path.join(SDCARD, 'DCIM')
            if not os.path.exists(fs):
                self._send(404, 'text/html', '<html><body>404 Not Found</body></html>')
                return
            if os.path.isdir(fs):
                entries = []
                for name in sorted(os.listdir(fs)):
                    fp = os.path.join(fs, name)
                    is_dir = os.path.isdir(fp)
                    mtime = datetime.datetime.fromtimestamp(os.path.getmtime(fp))
                    if is_dir:
                        entries.append((name, True, 4096, mtime))
                    else:
                        entries.append((name, False, os.path.getsize(fp), mtime))
                body = index_of_page(path, entries)
                self._send(200, 'text/html; charset=utf-8', body)
            else:
                ext = os.path.splitext(fs)[1].lower()
                ctype = CONTENT_TYPES.get(ext, 'application/octet-stream')
                with open(fs, 'rb') as f:
                    data = f.read()
                # 支持 Range(大图断点续传,模拟相机行为)
                rng = self.headers.get('Range')
                if rng:
                    m = rng.replace('bytes=', '').split('-')
                    start = int(m[0]) if m[0] else 0
                    end = int(m[1]) if m[1] and int(m[1]) < len(data) else len(data) - 1
                    self.send_response(206)
                    self.send_header('Content-Type', ctype)
                    self.send_header('Content-Range', 'bytes %d-%d/%d' % (start, end, len(data)))
                    self.send_header('Content-Length', str(end - start + 1))
                    self.end_headers()
                    if not head_only:
                        self.wfile.write(data[start:end + 1])
                    return
                self._send(200, ctype, data)
            return

        # ---- 其余路径:web_root 静态文件 ----
        rel = path.lstrip('/')
        if rel == '':
            rel = 'index.html'
        fp = os.path.join(WEB_ROOT, rel)
        if not os.path.isfile(fp):
            self._send(404, 'text/html', '<html><body>404 Not Found</body></html>')
            return
        ext = os.path.splitext(fp)[1].lower()
        ctype = CONTENT_TYPES.get(ext, 'application/octet-stream')
        with open(fp, 'rb') as f:
            data = f.read()
        self._send(200, ctype, data)


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    server = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    print('NX-KS2 模拟相机 Web 服务器: http://127.0.0.1:%d/  (Ctrl+C 退出)' % port)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
