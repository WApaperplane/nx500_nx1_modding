/* ============================================================
 * NX 远程控制器 - 相册(缩略图网格 + Lightbox)
 * 从相机端 /DCIM 目录抓取文件列表(递归子目录),
 * 渲染为缩略图网格;点击缩略图打开 Lightbox 自适应缩放查看。
 *
 * 内存/带宽优化(2026-08):
 * 1. 缩略图不再直接引用原图。优先走相机端缩略图 CGI
 *    (ImageMagick convert 生成,见 nx-rc/thumb/),单张 4-8MB -> 15-30KB;
 *    CGI 不可用时自动回退原图(卡但可用)。
 * 2. 分批渲染:每次只建一批 DOM(30 张),滚动到底自动加载下一批,
 *    避免几百个缩略图一次性进 DOM 导致内存暴涨。
 * 3. IntersectionObserver 按视口加载/释放:滚入视口才设置 src,
 *    滚出视口即清空 src 释放解码内存;不支持 IO 的浏览器退化为
 *    loading="lazy" 原逻辑。
 * ============================================================ */

/* 支持的媒体扩展名 */
Gallery.MEDIA_EXTS = {
    '.jpg': 'image', '.jpeg': 'image', '.png': 'image', '.gif': 'image',
    '.bmp': 'image', '.tif': 'image', '.tiff': 'image',
    '.mov': 'video', '.mp4': 'video', '.avi': 'video',
    '.3gp': 'video', '.m4v': 'video', '.webm': 'video'
};

/* 缩略图服务配置(相机端 thumb CGI,端口与 capdtm httpd 一致) */
Gallery.THUMB = {
    enabled: true,   // 相机端已部署 thumb CGI 时保持 true;未部署可置 false 退回原图
    port: 8080,      // busybox httpd 端口(与 capdtm-httpd.sh 一致)
    width: 400,      // 缩略图长边像素(网格 140px@2x DPR 足够)
    quality: 82
};

/* 同时发起的缩略图请求上限。
 *
 * 相机端 busybox httpd 是串行 fork ImageMagick 的,单核 CPU 下一次
 * convert 就要占满一个核。前端一次丢 30 个请求过去并不会并行,只会:
 *   1) 请求在 httpd 队列里堆积,首屏等待时间 = 所有 convert 串行耗时之和;
 *   2) CPU 长期 100%,80 端口 daemon 的 /api/v1/camera/status 心跳被饿死
 *      超时,前端误判"相机已断开"(点掉弹窗后图片其实照常加载)。
 * 因此前端主动限流,让相机端一次只处理少量请求,心跳才有空隙响应。
 */
Gallery.MAX_CONCURRENT = 2;

/* 目录树抓取:并发上限(用户连续点开多个目录时,同时只发这么多目录请求)。
 * 目录请求本身轻量(只取目录 HTML),不像缩略图 convert 那样吃满 CPU,
 * 但也要节制,避免把 daemon 的 HTTP 连接池占满拖慢遥控心跳。
 */
Gallery.DIR_CONCURRENCY = 3;

/* 目录清单内存缓存的保鲜时间(ms)。
 * 切走相册再切回来时,30 秒内不重新抓目录树,直接用缓存重建视图(秒开)。
 * 之前是 2 分钟,导致"遥控页拍完照切回相册看不到新照片"——
 * 拍照到回看的间隔通常落在 2 分钟内,全部被缓存吞掉;收紧到 30 秒
 * 既能挡住快速来回切页签的重复抓取,又不影响新照片回看(2026-09-04)。
 */
Gallery.TREE_CACHE_TTL = 30000;

/* 默认展开的"最新"目录数(其余目录收起,点目录头才加载) */
Gallery.DEFAULT_EXPAND = 1;

function Gallery(controllers) {
    this.controllers = controllers;
    this.iframe = null;
    this.rootUrl = null;     // 图库根地址,如 http://ip/DCIM
    this.groups = [];        // 目录清单 [{name,url,loaded,loading,items:[{file,index}]}]
    this.media = [];         // 已加载媒体的展平列表(顺序即显示顺序)
    this.rootFailed = false; // 根目录抓取是否失败
    this.lightbox = null;    // Lightbox jQuery 对象
    this.current = -1;       // Lightbox 当前索引
    this.touchStartX = 0;    // 触摸滑动起始 X
    this.selectMode = false; // 多选模式
    this.selection = {};     // 已选中项的索引集合
    this.downloading = false;// 批量下载进行中
    this._obs = null;        // IntersectionObserver(图片)
    this._loadQueue = [];    // 待发起的缩略图请求队列(限流)
    this._loading = 0;       // 已发起未完成的数量
    this._dirLoading = 0;    // 正在抓取中的目录数(限制目录请求并发)
    this._treeCache = null;  // 目录树缓存 {rootUrl, ts, groups:[...]}
    this._builtAt = 0;       // 上次成功构建视图的时间
    this._ioSupported = ('IntersectionObserver' in window) &&
                        ('IntersectionObserverEntry' in window);
}

/* ============ 初始化 ============ */

/* opts.force=true 强制重新抓取(刷新按钮);否则命中 2 分钟缓存直接重建视图 */
Gallery.prototype.init = function (url, opts) {
    var self = this;

    if (typeof url === 'undefined' || url === null || url === '') {
        url = 'http://' + app.hostname + '/DCIM';
    }
    self.rootUrl = url;
    var force = !!(opts && opts.force);

    // 缓存命中:直接用已抓到的目录/文件数据重建视图(免一次整树抓取)
    if (!force && self._treeCache &&
        self._treeCache.rootUrl === url &&
        (Date.now() - self._treeCache.ts) < Gallery.TREE_CACHE_TTL) {
        self.rootFailed = false;
        self.groups = self._treeCache.groups;
        self.media = self._treeCache.media;
        self.resetThumbQueue();
        self.mountFromCache();
        return;
    }

    self._treeCache = null;
    self.groups = [];
    self.media = [];
    self.rootFailed = false;
    self._dirLoading = 0;
    self.resetThumbQueue();

    // 先搭骨架再抓根目录:一旦读到目录清单即可立即渲染目录头。
    self.startRender();
    self.fetchRootTree(url);
};

/* ============ 目录树加载(只抓根清单,目录内容按需点开) ============ */

/* 抓根目录页:得到子目录清单后按名倒序(最新在上)渲染目录头,
 * 默认展开最新的 DEFAULT_EXPAND 个目录,其余收起。点开才抓该目录的文件。
 * 不再递归全量抓取 —— 这是"目录多时相册慢"的根治点。 */
Gallery.prototype.fetchRootTree = function (rootUrl) {
    var self = this;
    self.fetchDir(rootUrl).then(function (res) {
        var $g = $('#gallery');
        $g.find('.gallery-loading').remove();

        var names = [];
        var i;
        for (i = 0; i < res.dirs.length; i++) {
            var d = res.dirs[i];
            var nm = d.replace(/\/$/, '').split('/').pop();
            if (nm && nm !== '根目录') {
                names.push(nm);
            }
        }
        // 倒序:数字目录(100PHOTO..299PHOTO)最新在上;字母目录按字典序倒排
        names.sort().reverse();

        if (names.length === 0) {
            // 根目录无子目录:把根目录自身当做一个目录组(容错)
            self.groups = [{
                name: rootUrl.replace(/\/$/, '').split('/').pop() || 'DCIM',
                url: rootUrl,
                loaded: false, loading: false, items: []
            }];
            self.renderDirSections();
            self.toggleDir(self.groups[0].name);
            self.finishTreeLoad();
            return;
        }

        var j;
        for (j = 0; j < names.length; j++) {
            self.groups.push({
                name: names[j],
                url: rootUrl + (rootUrl.charAt(rootUrl.length - 1) === '/' ? '' : '/') +
                     names[j] + '/',
                loaded: false, loading: false, items: []
            });
        }
        self.renderDirSections();
        self.finishTreeLoad();

        // 默认展开最新目录(用户最想看刚拍的照片)
        var toExpand = Math.min(Gallery.DEFAULT_EXPAND, self.groups.length);
        for (j = 0; j < toExpand; j++) {
            self.toggleDir(self.groups[j].name, true);
        }
    }, function () {
        self.rootFailed = true;
        var $g = $('#gallery');
        $g.find('.gallery-loading').remove();
        $g.find('.gallery-count').text('读取失败');
        $g.append('<div class="gallery-error">无法读取相机相册目录(' +
                  rootUrl + ')。<br>请确认相机 Wi-Fi 已开启、Web 服务可用。</div>');
    });
};

/* 根清单读取完毕:缓存整棵树(供切页签回来时秒开) */
Gallery.prototype.finishTreeLoad = function () {
    var self = this;
    var $g = $('#gallery');
    var totalDirs = self.groups.length;
    var loadedFiles = self.media.length;
    $g.find('.gallery-count').text(totalDirs + ' 个目录 · ' +
                                  loadedFiles + ' 张(已展开)');
    self._treeCache = {
        rootUrl: self.rootUrl,
        ts: Date.now(),
        groups: self.groups,
        media: self.media
    };
    self._builtAt = Date.now();
};

/* 渲染目录头列表(全部折叠态),供点击展开 */
Gallery.prototype.renderDirSections = function () {
    var self = this;
    var $g = $('#gallery');
    var i;
    for (i = 0; i < self.groups.length; i++) {
        var g = self.groups[i];
        var $sec = $('<div class="gallery-section" data-dir="' +
                     self.escAttr(g.name) + '"></div>');
        var $head = $('<div class="gallery-dir-head" title="点击展开/收起"></div>');
        $head.append('<span class="gallery-dir-arrow">&#9654;</span>');
        $head.append($('<span class="gallery-dir-name"></span>').text(g.name));
        $head.append('<span class="gallery-dir-meta"></span>');
        var $grid = $('<div class="gallery-grid"></div>').hide();
        $sec.append($head).append($grid);
        $g.append($sec);

        (function (grp, sec) {
            $head.on('click', function (ev) {
                ev.stopPropagation();
                if (grp.loading) {
                    return; // 加载中不可重复点
                }
                self.toggleDir(grp.name);
            });
        })(g, $sec);
    }
    if (self.groups.length === 0) {
        $g.append('<div class="gallery-empty">SD 卡上没有找到照片目录。</div>');
    }
};

Gallery.prototype.escAttr = function (s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
                    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
};

/* 找目录 */
Gallery.prototype.findGroup = function (name) {
    var self = this;
    var i;
    for (i = 0; i < self.groups.length; i++) {
        if (self.groups[i].name === name) {
            return self.groups[i];
        }
    }
    return null;
};

/* 展开/收起目录;未加载的目录先抓文件再展开 */
Gallery.prototype.toggleDir = function (name, forceExpand) {
    var self = this;
    var g = self.findGroup(name);
    if (!g) {
        return;
    }
    var $sec = $('.gallery-section[data-dir="' + self.escAttr(name) + '"]');
    if ($sec.length === 0) {
        return;
    }

    if (!g.loaded && !g.loading) {
        self.loadDir(g, $sec);
        return;
    }
    if (g.loading) {
        return;
    }

    var willExpand = forceExpand === true || !g.expanded;
    g.expanded = willExpand;
    var $grid = $sec.find('.gallery-grid');
    if (willExpand) {
        $sec.find('.gallery-dir-arrow').html('&#9660;');
        $grid.show();
    } else {
        // 收起:释放网格内缩略图,节省解码内存
        $sec.find('.gallery-dir-arrow').html('&#9654;');
        self.releaseGridThumbs($grid);
        $grid.hide();
    }
    self.refreshCounter();
};

/* 抓取目录文件列表并渲染网格 */
Gallery.prototype.loadDir = function (g, $sec) {
    var self = this;
    g.loading = true;
    $sec.find('.gallery-dir-arrow').html('&#9660;');
    $sec.find('.gallery-dir-meta').html(
        '<span class="gallery-dir-spinner"></span> 读取中');
    $sec.find('.gallery-grid').show();

    // 限制目录请求并发:超过 DIR_CONCURRENCY 时排队等前面的完成
    var timer = null;
    var poll = setInterval(function () {
        if (self._dirLoading < Gallery.DIR_CONCURRENCY) {
            clearInterval(poll);
            if (timer) { clearTimeout(timer); }
            self._dirLoading++;
            self.fetchDir(g.url).then(function (res) {
                g.loading = false;
                self._dirLoading--;
                self.buildDirGrid(g, res.files);
            }, function () {
                g.loading = false;
                self._dirLoading--;
                $sec.find('.gallery-dir-meta').text('读取失败(点击重试)');
                $sec.find('.gallery-dir-arrow').html('&#9654;');
            });
        }
    }, 80);
};

/* 把抓到的文件列表构建为网格(文件最新在前) */
Gallery.prototype.buildDirGrid = function (g, rawFiles) {
    var self = this;
    var $sec = $('.gallery-section[data-dir="' + self.escAttr(g.name) + '"]');
    var $grid = $sec.find('.gallery-grid');

    // 过滤媒体,并倒序 -> 目录内最新照片在前
    var files = [];
    var i;
    for (i = 0; i < rawFiles.length; i++) {
        var f = rawFiles[i];
        var type = Gallery.MEDIA_EXTS[f.ext];
        if (type) {
            files.push({url: f.url, name: f.name, type: type, dir: g.name});
        }
    }
    files.reverse();

    var items = [];
    for (i = 0; i < files.length; i++) {
        var idx = self.media.length;
        self.media.push(files[i]);
        items.push({file: files[i], index: idx});
    }
    g.items = items;
    g.loaded = true;
    g.expanded = true;

    if (items.length === 0) {
        $grid.empty();
        $grid.append('<div class="gallery-dir-empty">此目录没有照片/视频</div>');
    } else {
        var frag = document.createDocumentFragment();
        for (i = 0; i < items.length; i++) {
            frag.appendChild(self.buildItem(items[i])[0]);
        }
        $grid.empty().append(frag);
    }
    $sec.find('.gallery-dir-meta').text(items.length + ' 项');
    self.refreshCounter();
};

/* 收起目录时释放其缩略图 src(解码内存)。
   仅在支持 IntersectionObserver 时清 src —— 不支持 IO 的降级浏览器
   依赖 img 自带 src + loading=lazy,清掉后重展开将无法恢复。 */
Gallery.prototype.releaseGridThumbs = function ($grid) {
    var self = this;
    if (!self._ioSupported) {
        return;
    }
    var imgs = $grid.find('img').get();
    var i;
    for (i = 0; i < imgs.length; i++) {
        var el = imgs[i];
        self.dequeueThumb(el);
        el._loaded = false;
        el._queued = false;
        if (el.getAttribute('src')) {
            el.removeAttribute('src');
        }
    }
};

/* 顶部计数 */
Gallery.prototype.refreshCounter = function () {
    var self = this;
    var loaded = 0;
    var i;
    for (i = 0; i < self.groups.length; i++) {
        if (self.groups[i].loaded) {
            loaded += self.groups[i].items.length;
        }
    }
    $('#gallery').find('.gallery-count').text(
        self.groups.length + ' 个目录 · ' + loaded + ' 张(已展开)');
};

/* 命中缓存:不重抓目录树,直接按已存 groups 重建视图 */
Gallery.prototype.mountFromCache = function () {
    var self = this;
    self.startRender();
    self.renderDirSections();
    var i;
    for (i = 0; i < self.groups.length; i++) {
        var g = self.groups[i];
        if (!g.loaded) {
            continue;
        }
        var $sec = $('.gallery-section[data-dir="' + self.escAttr(g.name) + '"]');
        var $grid = $sec.find('.gallery-grid');
        g.expanded = true;
        $sec.find('.gallery-dir-arrow').html('&#9660;');
        $sec.find('.gallery-dir-meta').text(g.items.length + ' 项');
        var frag = document.createDocumentFragment();
        var j;
        for (j = 0; j < g.items.length; j++) {
            frag.appendChild(self.buildItem(g.items[j])[0]);
        }
        $grid.empty().append(frag);
        $grid.show();
    }
    self.refreshCounter();
    self._builtAt = Date.now();
};

/* 目录列表服务:8080 实时 dirlist CGI 优先(2026-09-05)。
 * 80 端口 daemon 的 /DCIM 目录页是启动快照,新拍照片不出现,
 * 导致相册看不到最新照片;8080 CGI 每次请求都实时 readdir SD 卡。
 * dirlist 不可用时回退 80 端口 HTML 解析(旧行为)。 */
Gallery.DIRLIST = {
    enabled: true,
    port: 8080
};

/* 抓取单个目录:优先 JSON 实时列表,失败回退 HTML 解析 */
Gallery.prototype.fetchDir = function (url) {
    var self = this;
    return self.fetchDirJson(url).then(null, function () {
        return self.fetchDirHtml(url);
    });
};

/* 从 80 端口目录 URL 提取 DCIM 相对路径('' = 根) */
Gallery.dirRelPath = function (url) {
    var m = String(url).match(/\/DCIM\/?(.*)$/);
    if (!m) {
        return null;
    }
    return decodeURIComponent(m[1]).replace(/\/+$/, '');
};

/* 8080 dirlist:实时 JSON 目录列表 */
Gallery.prototype.fetchDirJson = function (url) {
    var self = this;
    return new Promise(function (resolve, reject) {
        if (!Gallery.DIRLIST.enabled) {
            reject(new Error('dirlist disabled'));
            return;
        }
        var rel = Gallery.dirRelPath(url);
        if (rel === null) {
            reject(new Error('not a DCIM url: ' + url));
            return;
        }
        var host = app.hostname || self.rootUrl &&
                   self.rootUrl.replace(/^https?:\/\//, '').split(':')[0].split('/')[0];
        $.ajax({
            url: 'http://' + host + ':' + Gallery.DIRLIST.port +
                 '/cgi-bin/dirlist?p=' + encodeURIComponent(rel),
            dataType: 'json',
            cache: false,
            timeout: 15000
        }).done(function (res) {
            if (!res || res.ok !== true) {
                reject(new Error('dirlist bad response'));
                return;
            }
            var baseUrl = 'http://' + host + '/DCIM/' + (rel ? rel + '/' : '');
            var out = {dirs: [], files: []};
            var i;
            for (i = 0; i < (res.dirs || []).length; i++) {
                out.dirs.push(baseUrl + res.dirs[i] + '/');
            }
            for (i = 0; i < (res.files || []).length; i++) {
                var name = res.files[i];
                var m = name.match(/\.([a-zA-Z0-9]+)$/);
                var ext = m ? '.' + m[1].toLowerCase() : '';
                if (ext && Gallery.MEDIA_EXTS[ext]) {
                    out.files.push({url: baseUrl + name, name: name, ext: ext});
                }
            }
            resolve(out);
        }).fail(function () {
            reject(new Error('dirlist fetch failed'));
        });
    });
};

/* 80 端口回退:抓取目录页 HTML(Mongoose "Index of" 表格) */
Gallery.prototype.fetchDirHtml = function (url) {
    return new Promise(function (resolve, reject) {
        $.ajax({
            url: url,
            dataType: 'text',
            cache: false,
            timeout: 20000
        }).done(function (html) {
            resolve(Gallery.parseDirHtml(html, url));
        }).fail(function () {
            reject(new Error('fetch failed: ' + url));
        });
    });
};

/* 解析目录页 HTML:提取子目录与媒体文件链接 */
Gallery.parseDirHtml = function (html, baseUrl) {
    var result = {dirs: [], files: []};
    var doc;
    try {
        doc = new DOMParser().parseFromString(html, 'text/html');
    } catch (e) {
        return result;
    }
    var links = doc.querySelectorAll('a[href]');
    var i;
    for (i = 0; i < links.length; i++) {
        var a = links[i];
        var href = a.getAttribute('href');
        if (!href || href.charAt(0) === '#' || href.indexOf('javascript:') === 0) {
            continue;
        }
        var text = a.textContent || '';
        var isDir = href.charAt(href.length - 1) === '/' ||
                    text.indexOf('[DIRECTORY]') !== -1;
        var abs = Gallery.resolveUrl(baseUrl, href);
        if (!abs) {
            continue;
        }
        if (isDir) {
            result.dirs.push(abs);
        } else {
            var m = text.match(/\.([a-zA-Z0-9]+)$/);
            var ext = m ? '.' + m[1].toLowerCase() : '';
            if (ext && Gallery.MEDIA_EXTS[ext]) {
                result.files.push({url: abs, name: text, ext: ext});
            }
        }
    }
    return result;
};

/* 相对链接解析为绝对地址 */
Gallery.resolveUrl = function (baseUrl, href) {
    if (href.indexOf('http://') === 0 || href.indexOf('https://') === 0) {
        return href;
    }
    // 目录页 URL 视作目录:解析相对链接前补尾斜杠,
    // 否则 new URL('100PHOTO/', 'http://host/DCIM') 会解析到 /100PHOTO/
    var base = baseUrl;
    var pathPart = base.split(/[?#]/)[0];
    var lastSeg = pathPart.substring(pathPart.lastIndexOf('/') + 1);
    var looksLikeFile = lastSeg.indexOf('.') !== -1;
    if (!looksLikeFile && base.charAt(base.length - 1) !== '/') {
        base += '/';
    }
    try {
        return new URL(href, base).href;
    } catch (e) {
        var idx = base.indexOf('?');
        var b = idx >= 0 ? base.substring(0, idx) : base;
        if (href.charAt(0) === '/') {
            var m = b.match(/^(https?:\/\/[^\/]+)/);
            return m ? m[1] + href : null;
        }
        if (b.charAt(b.length - 1) !== '/') {
            b += '/';
        }
        return b + href;
    }
};

/* ============ 渲染缩略图网格 ============ */

/* 搭骨架:工具条 + loading 提示 + 观察器。
   在抓根目录前调用,读到目录清单后即可立即渲染目录头。 */
Gallery.prototype.startRender = function () {
    var self = this;
    var $g = $('#gallery').empty();
    self.selection = {};
    self.selectMode = false;

    $g.append(self.buildToolbar());
    $g.find('.gallery-count').text('正在读取...');
    $g.append('<div class="gallery-loading"><span class="gallery-spinner"></span>' +
              '正在读取相机相册,请稍候...</div>');

    self.initObserver();
    self.initLightbox();
};

/* 构建单个网格项(图片不设 src,由 IO 按视口加载/释放) */
Gallery.prototype.buildItem = function (item) {
    var self = this;
    var file = item.file;
    var index = item.index;

    var $item = $('<div class="gallery-item" data-index="' + index + '"></div>');
    if (file.type === 'video') {
        // 视频无缩略图,显示占位 + 播放图标,不加载视频本体
        $item.append('<div class="gallery-video-thumb"></div>');
        $item.append('<span class="gallery-video-icon">&#9654;</span>');
    } else {
        var thumb = self.thumbUrl(file);
        var $img = $('<img alt="" decoding="async" />')
            .attr('data-src', thumb)
            .attr('data-orig', file.url);
        if (!self._ioSupported) {
            // 降级路径:直接加载(浏览器自行懒加载)
            $img.attr('src', thumb).attr('loading', 'lazy');
        }
        $img.on('error', function () {
            var $i = $(this);
            if ($i.data('fb')) {
                // 原图也失败:显示占位
                $i.removeAttr('src').addClass('gallery-img-fallback');
            } else {
                // 缩略图失败:回退加载原图(相机端未部署 CGI 时保证可用)
                $i.data('fb', true);
                $i.attr('src', $i.data('orig'));
            }
        });
        $item.append($img);
        if (self._ioSupported) {
            self._obs.observe($img[0]);
        }
    }
    // 多选角标
    $item.append('<span class="gallery-check">&#10003;</span>');
    $item.attr('title', file.name);
    if (self.selection[index]) {
        $item.addClass('selected');
        $item.find('.gallery-check').addClass('checked');
    }
    (function (p) {
        $item.on('click', function (ev) {
            if (self.selectMode) {
                ev.stopPropagation();
                self.toggleSelect(p);
            } else {
                self.openLightbox(p);
            }
        });
    })(index);
    return $item;
};

/* 缩略图 URL:相机端 thumb CGI 不可用时退回原图 */
Gallery.prototype.thumbUrl = function (file) {
    if (!Gallery.THUMB.enabled || file.type !== 'image') {
        return file.url;
    }
    var u;
    try {
        u = new URL(file.url);
    } catch (e) {
        return file.url;
    }
    var rel = decodeURIComponent(u.pathname.replace(/^\/DCIM\/?/, ''));
    if (!rel) {
        return file.url;
    }
    return 'http://' + u.hostname + ':' + Gallery.THUMB.port +
           '/cgi-bin/thumb?f=' + encodeURIComponent(rel) +
           '&w=' + Gallery.THUMB.width + '&q=' + Gallery.THUMB.quality;
};

/* 视口观察:进入视口加载 src,滚出视口清空 src 释放解码内存 */
Gallery.prototype.initObserver = function () {
    var self = this;
    if (!self._ioSupported) {
        return;
    }
    self.removeObserver();

    // 图片观察器:rootMargin 大,提前 1.5 屏加载/释放
    self._obs = new IntersectionObserver(function (entries) {
        var i;
        for (i = 0; i < entries.length; i++) {
            var en = entries[i];
            var el = en.target;
            if (en.isIntersecting) {
                var $img = $(el);
                if (!el.getAttribute('src') && $img.data('src')) {
                    // 入队而非直接发起,由调度器按并发上限发放
                    self.enqueueThumb(el);
                }
            } else {
                // 滚出视口:释放解码内存(回退原图的不再释放,避免反复下载大图)
                var $out = $(el);
                // 还在排队未发起的,直接取消,不占相机端资源
                if (self.dequeueThumb(el)) {
                    continue;
                }
                if (!$out.data('fb') && el.getAttribute('src')) {
                    el.removeAttribute('src');
                    el._loaded = false; // 允许滚回时重新入队
                }
            }
        }
    }, {
        rootMargin: '150% 0px',
        threshold: 0.01
    });
};

/* ============ 缩略图请求限流队列 ============ */

/* 入队:等待调度器发放请求 */
Gallery.prototype.enqueueThumb = function (img) {
    var self = this;
    if (img._queued || img._loaded) {
        return;
    }
    img._queued = true;
    self._loadQueue.push(img);
    self.pumpThumbs();
};

/* 出队:滚出视口时尚未发起的请求直接取消 */
Gallery.prototype.dequeueThumb = function (img) {
    var self = this;
    if (!img._queued) {
        return false;
    }
    var idx = self._loadQueue.indexOf(img);
    if (idx >= 0) {
        self._loadQueue.splice(idx, 1);
    }
    img._queued = false;
    return true;
};

/* 调度:维持并发数不超过 MAX_CONCURRENT */
Gallery.prototype.pumpThumbs = function () {
    var self = this;
    var guard = 0;
    while (self._loading < Gallery.MAX_CONCURRENT &&
           self._loadQueue.length > 0 &&
           guard++ < 200) {
        var img = self._loadQueue.shift();
        img._queued = false;
        var $img = $(img);
        var src = $img.data('src');
        if (!src) {
            continue;
        }
        self._loading++;
        // 完成/失败后释放槽位并继续发放下一张
        $img.one('load.nxthumb error.nxthumb', function () {
            self._loading--;
            this._loaded = true;
            self.pumpThumbs();
        });
        img.setAttribute('src', src);
    }
};

/* 清空队列(刷新相册/切换相机时调用) */
Gallery.prototype.resetThumbQueue = function () {
    var self = this;
    var i;
    for (i = 0; i < self._loadQueue.length; i++) {
        self._loadQueue[i]._queued = false;
    }
    self._loadQueue = [];
    self._loading = 0;
};

/* 注销观察器(刷新/重进相册时调用) */
Gallery.prototype.removeObserver = function () {
    var self = this;
    if (self._obs) {
        self._obs.disconnect();
        self._obs = null;
    }
};

/* 顶部工具条 */
Gallery.prototype.buildToolbar = function () {
    var self = this;
    var $bar = $('<div class="gallery-toolbar"></div>');
    $bar.append($('<span class="gallery-count"></span>').text('共 ' + self.media.length + ' 个文件'));
    var $refresh = $('<button type="button" class="btn btn-xs btn-default">刷新</button>')
        .on('click', function () {
            // 必须带 force:否则 2 分钟 TTL 内命中目录树缓存,
            // 点了刷新却什么都不重抓,拍完新照片看不到(2026-09-04 修复)
            self.init(self.rootUrl, {force: true});
        });
    var $orig = $('<button type="button" class="btn btn-xs btn-default">原始目录视图</button>')
        .on('click', function () {
            self.showIframeView();
        });

    var $select = $('<button type="button" class="btn btn-xs btn-info">选择</button>')
        .on('click', function () {
            self.setSelectMode(!self.selectMode);
        });
    var $selectAll = $('<button type="button" class="btn btn-xs btn-default" style="display:none;">全选</button>')
        .on('click', function () {
            self.selectAll();
        });
    var $download = $('<button type="button" class="btn btn-xs btn-success" style="display:none;">下载选中</button>')
        .on('click', function () {
            self.downloadSelected();
        });
    var $cancel = $('<button type="button" class="btn btn-xs btn-default" style="display:none;">取消</button>')
        .on('click', function () {
            self.setSelectMode(false);
        });
    var $dlInfo = $('<span class="gallery-dl-info" style="display:none;"></span>');

    $bar.append($refresh).append($orig).append($select)
        .append($selectAll).append($download).append($cancel)
        .append($dlInfo);
    self._selectBtn = $select;
    self._selectAllBtn = $selectAll;
    self._downloadBtn = $download;
    self._cancelBtn = $cancel;
    self._dlInfo = $dlInfo;
    return $bar;
};

/* 进入/退出多选模式 */
Gallery.prototype.setSelectMode = function (on) {
    var self = this;
    self.selectMode = on;
    if (on) {
        self._selectBtn.text('取消选择').removeClass('btn-info').addClass('btn-default');
        self._selectAllBtn.show();
        self._downloadBtn.show();
        self._cancelBtn.show();
    } else {
        self._selectBtn.text('选择').removeClass('btn-default').addClass('btn-info');
        self._selectAllBtn.hide();
        self._downloadBtn.hide();
        self._cancelBtn.hide();
        self.selection = {};
    }
    self.updateItemStates();
    self.updateDownloadCount();
};

Gallery.prototype.toggleSelect = function (index) {
    var self = this;
    if (self.selection[index]) {
        delete self.selection[index];
    } else {
        self.selection[index] = true;
    }
    self.updateItemStates();
    self.updateDownloadCount();
};

Gallery.prototype.selectAll = function () {
    var self = this;
    var i;
    for (i = 0; i < self.media.length; i++) {
        self.selection[i] = true;
    }
    self.updateItemStates();
    self.updateDownloadCount();
};

Gallery.prototype.updateItemStates = function () {
    var self = this;
    $('#gallery .gallery-item').each(function () {
        var idx = $(this).data('index');
        if (self.selectMode) {
            $(this).addClass('selectable');
        } else {
            $(this).removeClass('selectable');
        }
        if (self.selection[idx]) {
            $(this).addClass('selected');
            $(this).find('.gallery-check').addClass('checked');
        } else {
            $(this).removeClass('selected');
            $(this).find('.gallery-check').removeClass('checked');
        }
    });
};

Gallery.prototype.updateDownloadCount = function () {
    var self = this;
    var n = Object.keys(self.selection).length;
    if (self._downloadBtn) {
        self._downloadBtn.text(n > 0 ? ('下载选中 (' + n + ')') : '下载选中');
    }
};

/* 下载单个文件(同源,直接 fetch 为 Blob 后保存) */
Gallery.prototype.downloadOne = function (file, done) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', file.url, true);
    xhr.responseType = 'blob';
    xhr.onload = function () {
        if (xhr.status === 200 && xhr.response) {
            var url = URL.createObjectURL(xhr.response);
            var a = document.createElement('a');
            a.href = url;
            var dlName = file.name;
            if (file.dir && file.dir !== '根目录') {
                dlName = file.dir + '_' + file.name;
            }
            a.download = dlName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
            done(true);
        } else {
            done(false);
        }
    };
    xhr.onerror = function () { done(false); };
    xhr.send();
};

/* 批量下载:串行逐张下载(避免并发打满相机 WiFi) */
Gallery.prototype.downloadSelected = function () {
    var self = this;
    var indexes = Object.keys(self.selection);
    var i = 0;
    var ok = 0;
    var fail = 0;
    if (indexes.length === 0 || self.downloading) {
        return;
    }
    self.downloading = true;
    self._dlInfo.show().text('正在下载 0/' + indexes.length + ' ...');
    self._downloadBtn.prop('disabled', true);

    function next() {
        if (i >= indexes.length) {
            self.downloading = false;
            self._downloadBtn.prop('disabled', false);
            var msg = '下载完成:成功 ' + ok + (fail > 0 ? (',失败 ' + fail) : '');
            self._dlInfo.text(msg);
            setTimeout(function () { self._dlInfo.hide(); }, 6000);
            return;
        }
        var file = self.media[indexes[i]];
        self._dlInfo.text('正在下载 ' + (i + 1) + '/' + indexes.length + ' ...');
        self.downloadOne(file, function (success) {
            if (success) { ok++; } else { fail++; }
            i++;
            next();
        });
    }
    next();
};

/* 降级:以 iframe 打开相机端原始目录页 */
Gallery.prototype.showIframeView = function () {
    var self = this;
    var $g = $('#gallery').empty();
    var $bar = $('<div class="gallery-toolbar"></div>');
    $bar.append($('<button type="button" class="btn btn-xs btn-default">返回缩略图视图</button>')
        .on('click', function () {
            // force:原始目录视图期间可能拍了对新照片,
            // 返回时不能沿用旧目录树缓存
            self.init(self.rootUrl, {force: true});
        }));
    $g.append($bar);

    var $iframe = $('<iframe id="galleryContent"></iframe>').attr('src', self.rootUrl);
    $g.append($iframe);

    function resize_iframe() {
        var height = window.innerWidth; // Firefox
        if (document.body.clientHeight) {
            height = document.body.clientHeight; // IE
        }
        if (self.iframe != null) {
            self.iframe.css('height', (height - 50) + 'px');
        }
    }
    self.iframe = $iframe;
    resize_iframe();
    window.onresize = resize_iframe;
};

/* ============ Lightbox 查看原图 ============ */
Gallery.prototype.initLightbox = function () {
    var self = this;
    if (self.lightbox) {
        return;
    }
    var $lb = $('<div id="galleryLightbox" class="gallery-lightbox"></div>');
    $lb.append('<div class="gallery-lb-toolbar">' +
               '<span class="gallery-lb-counter"></span>' +
               '<button type="button" class="gallery-lb-dl" title="下载当前文件">' +
               '<i class="fa fa-download"></i></button>' +
               '<button type="button" class="gallery-lb-close" title="关闭 (Esc)">&times;</button>' +
               '</div>');
    $lb.append('<div class="gallery-lb-stage">' +
               '<div class="gallery-lb-spinner"></div>' +
               '<img class="gallery-lb-media gallery-lb-image" alt="" />' +
               '<video class="gallery-lb-media gallery-lb-video" controls preload="metadata"></video>' +
               '</div>');
    $lb.append('<button type="button" class="gallery-lb-nav gallery-lb-prev" title="上一张 (&#8592;)">&#8249;</button>');
    $lb.append('<button type="button" class="gallery-lb-nav gallery-lb-next" title="下一张 (&#8594;)">&#8250;</button>');
    $lb.hide();
    $('body').append($lb);
    self.lightbox = $lb;

    // 关闭
    $lb.find('.gallery-lb-close').on('click', function () {
        self.closeLightbox();
    });
    // 下载当前文件
    $lb.find('.gallery-lb-dl').on('click', function () {
        var file = self.media[self.current];
        if (file) {
            self.downloadOne(file, function (success) {
                var $c = $lb.find('.gallery-lb-counter');
                if (success) {
                    $c.text($c.text() + ' (已开始下载)');
                } else {
                    $c.text($c.text() + ' (下载失败)');
                }
                setTimeout(function () {
                    $c.text((self.current + 1) + ' / ' + self.media.length);
                }, 2500);
            });
        }
    });
    $lb.on('click', function (e) {
        if (e.target === this) {
            self.closeLightbox();
        }
    });
    // 导航
    $lb.find('.gallery-lb-prev').on('click', function () {
        self.navigate(-1);
    });
    $lb.find('.gallery-lb-next').on('click', function () {
        self.navigate(1);
    });
    // 键盘
    $(document).on('keydown', function (e) {
        if (!self.lightbox || !self.lightbox.is(':visible')) {
            return;
        }
        if (e.keyCode === 27) {
            self.closeLightbox();
        } else if (e.keyCode === 37) {
            self.navigate(-1);
        } else if (e.keyCode === 39) {
            self.navigate(1);
        }
    });
    // 触摸滑动
    $lb.on('touchstart', function (e) {
        var t = e.originalEvent.touches;
        if (t && t.length > 0) {
            self.touchStartX = t[0].clientX;
        }
    });
    $lb.on('touchend', function (e) {
        var t = e.originalEvent.changedTouches;
        if (!t || t.length === 0) {
            return;
        }
        var dx = t[0].clientX - self.touchStartX;
        if (Math.abs(dx) > 40) {
            if (dx < 0) {
                self.navigate(1);
            } else {
                self.navigate(-1);
            }
        }
    });
};

Gallery.prototype.openLightbox = function (index) {
    var self = this;
    if (index < 0 || index >= self.media.length) {
        return;
    }
    self.initLightbox();
    self.current = index;
    self.updateLightbox();
    self.lightbox.show();
    $('body').css('overflow', 'hidden');
};

Gallery.prototype.closeLightbox = function () {
    var self = this;
    if (self.lightbox) {
        self.lightbox.hide();
        self.lightbox.find('.gallery-lb-image').attr('src', '');
        self.lightbox.find('.gallery-lb-video').attr('src', '');
    }
    self.current = -1;
    $('body').css('overflow', '');
};

Gallery.prototype.navigate = function (delta) {
    var self = this;
    var n = self.media.length;
    if (n === 0) {
        return;
    }
    self.current = (self.current + delta + n) % n;
    self.updateLightbox();
};

Gallery.prototype.updateLightbox = function () {
    var self = this;
    if (!self.lightbox) {
        return;
    }
    var file = self.media[self.current];
    var $lb = self.lightbox;
    var $counter = $lb.find('.gallery-lb-counter');
    var $spinner = $lb.find('.gallery-lb-spinner');
    var $img = $lb.find('.gallery-lb-image');
    var $video = $lb.find('.gallery-lb-video');

    $counter.text((self.current + 1) + ' / ' + self.media.length);
    $img.hide().attr('src', '');
    $video.hide().attr('src', '');

    if (file.type === 'video') {
        $spinner.hide();
        $video.attr('src', file.url).show();
    } else {
        $spinner.show();
        $img.off('.lb');
        $img.on('load.lb', function () {
            $spinner.hide();
            $img.fadeIn(120);
        });
        $img.on('error.lb', function () {
            $spinner.hide();
            $img.attr('src', '');
            $counter.text($counter.text() + ' (加载失败)');
        });
        $img.attr('src', file.url).hide();
    }

    // 预加载相邻图片
    if (file.type === 'image') {
        if (self.current - 1 >= 0 && self.media[self.current - 1].type === 'image') {
            new Image().src = self.media[self.current - 1].url;
        }
        if (self.current + 1 < self.media.length && self.media[self.current + 1].type === 'image') {
            new Image().src = self.media[self.current + 1].url;
        }
    }
};
