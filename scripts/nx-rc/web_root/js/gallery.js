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

/* 每批渲染的图片数量 */
Gallery.BATCH = 30;

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

/* 目录树抓取并发数。
 *
 * 旧实现是严格串行:一个目录请求回来才发下一个,且必须等全部目录读完
 * 才开始渲染。SD 卡上有 20 个目录就是 21 次串行往返,期间用户只能看
 * 转圈——这是"相册打开慢"的另一半原因(另一半是缩略图现算)。
 *
 * 现在改为并发抓取 + 流式渲染:抓完一个目录立刻渲染一个分组,
 * 首屏几乎立刻出图,剩余目录在后台继续读。
 * 并发数仍保守取 3:daemon 并发能力有限,太猛会拖慢遥控心跳。
 */
Gallery.DIR_CONCURRENCY = 3;

function Gallery(controllers) {
    this.controllers = controllers;
    this.iframe = null;
    this.rootUrl = null;     // 图库根地址,如 http://ip/DCIM
    this.groups = [];        // 按目录分组的文件 [{name, url, files:[{url,name,type}]}]
    this.media = [];         // 展平后的媒体列表,顺序即显示顺序
    this.rootFailed = false; // 根目录抓取是否失败
    this.lightbox = null;    // Lightbox jQuery 对象
    this.current = -1;       // Lightbox 当前索引
    this.touchStartX = 0;    // 触摸滑动起始 X
    this.selectMode = false; // 多选模式
    this.selection = {};     // 已选中项的索引集合
    this.downloading = false;// 批量下载进行中
    this._renderQueue = [];  // 分批渲染队列:[{groupName, file, index}]
    this._renderCursor = 0;  // 队列消费游标
    this._renderDone = false;// 队列是否已全部渲染
    this._sentinel = null;   // 滚动加载哨兵元素
    this._obs = null;        // IntersectionObserver(图片)
    this._sentinelObs = null;// IntersectionObserver(哨兵,分批加载)
    this._loadQueue = [];    // 待发起的缩略图请求队列(限流)
    this._loading = 0;       // 已发起未完成的数量
    this._loadDone = false;  // 目录树是否已全部抓取完毕
    this._sentinelInView = false; // 哨兵是否处于视口(决定能否继续补渲染)
    this._ioSupported = ('IntersectionObserver' in window) &&
                        ('IntersectionObserverEntry' in window);
}

/* ============ 初始化 ============ */
Gallery.prototype.init = function (url) {
    var self = this;

    if (typeof url === 'undefined' || url === null || url === '') {
        url = 'http://' + app.hostname + '/DCIM';
    }
    self.rootUrl = url;
    self.groups = [];
    self.media = [];
    self.rootFailed = false;
    self.resetThumbQueue();

    // 先搭好骨架(工具条/哨兵/观察器),再开始抓目录,
    // 这样第一个目录读完就能立刻出图,不必等整棵树。
    self.startRender();
    self.loadTree(url);
};

/* ============ 递归抓取目录树 ============ */
Gallery.prototype.loadTree = function (rootUrl) {
    var self = this;
    var queue = [{url: rootUrl, name: '根目录', depth: 0}];
    var seen = {};
    seen[rootUrl] = true;
    var inflight = 0;

    /* 维持 DIR_CONCURRENCY 个在途请求;全部归零即代表整棵树读完 */
    function pump() {
        while (inflight < Gallery.DIR_CONCURRENCY && queue.length > 0) {
            inflight++;
            fetchOne(queue.shift());
        }
        if (inflight === 0 && queue.length === 0) {
            self.finishLoad();
        }
    }

    function fetchOne(item) {
        self.fetchDir(item.url).then(function (res) {
            var i;
            // 子目录入队(限制深度,防止意外过深)
            for (i = 0; i < res.dirs.length; i++) {
                var d = res.dirs[i];
                if (item.depth < 3 && !seen[d]) {
                    seen[d] = true;
                    var name = d.replace(/\/$/, '').split('/').pop();
                    queue.push({url: d, name: name, depth: item.depth + 1});
                }
            }
            // 过滤出媒体文件
            var files = [];
            for (i = 0; i < res.files.length; i++) {
                var f = res.files[i];
                var type = Gallery.MEDIA_EXTS[f.ext];
                if (type) {
                    files.push({url: f.url, name: f.name, type: type,
                                dir: item.name});
                }
            }
            // 流式:读完一个目录就渲染一个分组
            if (files.length > 0) {
                self.groups.push({name: item.name, url: item.url, files: files});
                self.addGroup(item.name, files);
            }
            inflight--;
            pump();
        }, function () {
            // 目录抓取失败:根目录失败要提示,子目录失败则跳过
            if (item.url === rootUrl) {
                self.rootFailed = true;
            }
            inflight--;
            pump();
        });
    }

    pump();
};

/* 抓取单个目录页(相机端返回 Mongoose "Index of" HTML 表格) */
Gallery.prototype.fetchDir = function (url) {
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

/* 搭骨架:工具条 + 加载提示 + 哨兵 + 观察器。
   在目录抓取之前调用,使第一个分组读完即可立即出图。 */
Gallery.prototype.startRender = function () {
    var self = this;
    var $g = $('#gallery').empty();
    self.selection = {};
    self.selectMode = false;
    self._renderQueue = [];
    self._renderCursor = 0;
    self._renderDone = false;
    self._loadDone = false;

    $g.append(self.buildToolbar());
    $g.find('.gallery-count').text('正在读取...');
    // loading 提示放在哨兵之前(哨兵必须始终在容器末尾)
    $g.append('<div class="gallery-loading"><span class="gallery-spinner"></span>' +
              '正在读取相机相册,请稍候...</div>');

    if (self._ioSupported) {
        self._sentinel = $('<div class="gallery-sentinel"></div>').appendTo($g);
        self.initObserver();
    }
    self.initLightbox();
};

/* 流式追加一个目录分组:读完即渲染,不等整棵树 */
Gallery.prototype.addGroup = function (name, files) {
    var self = this;
    var i;
    for (i = 0; i < files.length; i++) {
        var index = self.media.length;
        self.media.push(files[i]);
        self._renderQueue.push({groupName: name, file: files[i], index: index});
    }

    var $g = $('#gallery');
    // 首个分组到达即撤掉转圈提示
    $g.find('.gallery-loading').remove();
    $g.find('.gallery-count').text(
        self._loadDone ? '共 ' + self.media.length + ' 个文件'
                       : '已读取 ' + self.media.length + ' 个文件');

    if (self._ioSupported) {
        // 首屏凑满 BATCH 前,每来一个分组就补渲染;之后交给哨兵滚动触发。
        // 注意:若哨兵此刻仍在视口内,必须主动补一批 —— IntersectionObserver
        // 只在"状态变化"时回调,数据后续到达不会再触发,否则会卡住不加载。
        if (self._renderCursor < Gallery.BATCH) {
            self.renderMore(Gallery.BATCH - self._renderCursor);
        } else if (self._sentinelInView) {
            self.renderMore(Gallery.BATCH);
        } else {
            self.updateSentinel();
        }
    }
};

/* 目录树全部抓取完毕:收尾(空相册提示 / 降级一次性渲染 / 结束态) */
Gallery.prototype.finishLoad = function () {
    var self = this;
    self._loadDone = true;
    var $g = $('#gallery');
    $g.find('.gallery-loading').remove();

    if (self.media.length === 0) {
        $g.find('.gallery-count').text(self.rootFailed ? '读取失败' : '无文件');
        if (self.rootFailed) {
            $g.append('<div class="gallery-error">无法读取相机相册目录(' +
                      self.rootUrl + ')。<br>请确认相机 Wi-Fi 已开启、Web 服务可用。</div>');
        } else {
            $g.append('<div class="gallery-empty">相册中没有找到照片或视频。</div>');
        }
        if (self._sentinel) {
            self._sentinel.remove();
            self._sentinel = null;
        }
        return;
    }

    $g.find('.gallery-count').text('共 ' + self.media.length + ' 个文件');

    if (!self._ioSupported) {
        // 旧浏览器降级:一次性渲染全部
        self.renderAll();
        return;
    }
    if (self._renderCursor >= self._renderQueue.length) {
        self.finishRender();
    } else if (self._sentinelInView) {
        // 目录读完但队列还有余量,且哨兵可见:继续补,否则要等用户滚动才出图
        self.renderMore(Gallery.BATCH);
    } else {
        self.updateSentinel();
    }
};

/* 队列消费完毕且目录已读完 —— 真正的结束态 */
Gallery.prototype.finishRender = function () {
    var self = this;
    self._renderDone = true;
    if (self._sentinel) {
        self._sentinel.remove();
        self._sentinel = null;
    }
    $('#gallery').append($('<div class="gallery-load-all"></div>')
        .text('已加载全部 ' + self.media.length + ' 个文件'));
};

/* 更新哨兵文案(区分"还在读目录"与"已读完只差滚动") */
Gallery.prototype.updateSentinel = function () {
    var self = this;
    if (!self._sentinel) {
        return;
    }
    if (self._loadDone) {
        self._sentinel.text('已加载 ' + self._renderCursor + ' / ' +
                            self._renderQueue.length + ' ...');
    } else {
        self._sentinel.text('读取中 ' + self._renderCursor + ' / 已发现 ' +
                            self._renderQueue.length + ' ...');
    }
};

/* 一次性渲染全部(不支持 IntersectionObserver 时的降级路径) */
Gallery.prototype.renderAll = function () {
    var self = this;
    var $g = $('#gallery');
    var currentGroup = null;
    var $grid = null;
    var i;
    for (i = 0; i < self._renderQueue.length; i++) {
        var item = self._renderQueue[i];
        if (item.groupName !== currentGroup) {
            currentGroup = item.groupName;
            var $sec = $('<div class="gallery-section"></div>');
            $sec.append($('<div class="gallery-dir-name"></div>').text(item.groupName));
            $grid = $('<div class="gallery-grid"></div>');
            $sec.append($grid);
            $g.append($sec);
        }
        $grid.append(self.buildItem(item));
    }
    self._renderDone = true;
    self._renderQueue = [];
};

/* 从队列渲染下一批(每批 BATCH 张,跨目录时自动插入分组头) */
Gallery.prototype.renderMore = function (count) {
    var self = this;
    if (self._renderDone) {
        return;
    }
    var $g = $('#gallery');
    var currentGroup = null;
    var $grid = null;

    // 定位当前已渲染到的分组,以便跨批续接
    var lastSec = $g.children('.gallery-section').last();
    if (lastSec.length > 0) {
        currentGroup = lastSec.find('.gallery-dir-name').text();
        $grid = lastSec.find('.gallery-grid');
    }

    var rendered = 0;
    while (self._renderCursor < self._renderQueue.length && rendered < count) {
        var item = self._renderQueue[self._renderCursor];
        if (item.groupName !== currentGroup) {
            currentGroup = item.groupName;
            var $sec = $('<div class="gallery-section"></div>');
            $sec.append($('<div class="gallery-dir-name"></div>').text(item.groupName));
            $grid = $('<div class="gallery-grid"></div>');
            $sec.append($grid);
            // 插到哨兵之前(哨兵必须始终在网格末尾)
            if (self._sentinel) {
                self._sentinel.before($sec);
            } else {
                $g.append($sec);
            }
        }
        $grid.append(self.buildItem(item));
        self._renderCursor++;
        rendered++;
    }

    // 队列消费完:目录也已读完才是真结束,否则保留哨兵等后续分组到达
    if (self._renderCursor >= self._renderQueue.length) {
        if (self._loadDone) {
            self.finishRender();
        } else {
            self.updateSentinel();
        }
    } else if (self._sentinelInView) {
        // 哨兵仍在视口内:继续补一批,避免"新数据到达却无人触发渲染"
        self.renderMore(Gallery.BATCH);
    } else {
        self.updateSentinel();
    }
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

    // 哨兵观察器:rootMargin 小,保证"进入/离开"状态切换以持续触发分批加载
    // (若与图片同用大 rootMargin,哨兵会一直处于 intersecting,批次只触发一次)
    if (self._sentinel) {
        self._sentinelObs = new IntersectionObserver(function (entries) {
            // 记录可见状态:流式追加分组时据此判断能否继续补渲染
            self._sentinelInView = entries[0].isIntersecting;
            if (self._sentinelInView) {
                self.renderMore(Gallery.BATCH);
            }
        }, {
            rootMargin: '300px 0px',
            threshold: 0
        });
        self._sentinelObs.observe(self._sentinel[0]);
    }
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
    if (self._sentinelObs) {
        self._sentinelObs.disconnect();
        self._sentinelObs = null;
    }
};

/* 顶部工具条 */
Gallery.prototype.buildToolbar = function () {
    var self = this;
    var $bar = $('<div class="gallery-toolbar"></div>');
    $bar.append($('<span class="gallery-count"></span>').text('共 ' + self.media.length + ' 个文件'));
    var $refresh = $('<button type="button" class="btn btn-xs btn-default">刷新</button>')
        .on('click', function () {
            self.init(self.rootUrl);
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
            self.init(self.rootUrl);
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
