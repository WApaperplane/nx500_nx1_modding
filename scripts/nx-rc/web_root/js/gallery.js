/* ============================================================
 * NX 远程控制器 - 相册(缩略图网格 + Lightbox)
 * 从相机端 /DCIM 目录抓取文件列表(递归子目录),
 * 渲染为缩略图网格;点击缩略图打开 Lightbox 自适应缩放查看。
 * 相机端无法生成缩略图,缩略图直接引用原图(CSS 裁切显示),
 * 已启用懒加载以缓解 WiFi 直连大图的加载压力。
 * ============================================================ */

/* 支持的媒体扩展名 */
Gallery.MEDIA_EXTS = {
    '.jpg': 'image', '.jpeg': 'image', '.png': 'image', '.gif': 'image',
    '.bmp': 'image', '.tif': 'image', '.tiff': 'image',
    '.mov': 'video', '.mp4': 'video', '.avi': 'video',
    '.3gp': 'video', '.m4v': 'video', '.webm': 'video'
};

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

    var $g = $('#gallery').empty();
    $g.append('<div class="gallery-loading"><span class="gallery-spinner"></span>正在读取相机相册,请稍候...</div>');

    self.loadTree(url);
};

/* ============ 递归抓取目录树 ============ */
Gallery.prototype.loadTree = function (rootUrl) {
    var self = this;
    var queue = [{url: rootUrl, name: '根目录', depth: 0}];
    var seen = {};
    seen[rootUrl] = true;

    function next() {
        if (queue.length === 0) {
            self.render();
            return;
        }
        var item = queue.shift();
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
            if (files.length > 0) {
                self.groups.push({name: item.name, url: item.url, files: files});
            }
            next();
        }, function () {
            // 目录抓取失败:根目录失败要提示,子目录失败则跳过
            if (queue.length === 0 && item.url === rootUrl) {
                self.rootFailed = true;
            }
            next();
        });
    }
    next();
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
Gallery.prototype.render = function () {
    var self = this;
    var $g = $('#gallery').empty();
    self.selection = {};
    self.selectMode = false;

    if (self.rootFailed) {
        $g.append('<div class="gallery-error">无法读取相机相册目录(' +
                  self.rootUrl + ')。<br>请确认相机 Wi-Fi 已开启、Web 服务可用。</div>');
        $g.append(self.buildToolbar());
        return;
    }
    if (self.groups.length === 0) {
        $g.append('<div class="gallery-empty">相册中没有找到照片或视频。</div>');
        $g.append(self.buildToolbar());
        return;
    }

    $g.append(self.buildToolbar());

    var pos = 0;
    self.media = [];
    var gi;
    for (gi = 0; gi < self.groups.length; gi++) {
        var group = self.groups[gi];
        var $sec = $('<div class="gallery-section"></div>');
        $sec.append($('<div class="gallery-dir-name"></div>').text(group.name));
        var $grid = $('<div class="gallery-grid"></div>');

        var fi;
        for (fi = 0; fi < group.files.length; fi++) {
            var file = group.files[fi];
            var index = self.media.length;
            self.media.push(file);

            var $item = $('<div class="gallery-item" data-index="' + index + '"></div>');
            if (file.type === 'video') {
                // 视频无缩略图,显示占位 + 播放图标,不加载视频本体
                $item.append('<div class="gallery-video-thumb"></div>');
                $item.append('<span class="gallery-video-icon">&#9654;</span>');
            } else {
                var $img = $('<img loading="lazy" alt="" />').attr('src', file.url);
                $item.append($img);
            }
            // 多选角标
            $item.append('<span class="gallery-check">&#10003;</span>');
            $item.attr('title', file.name);
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
            $grid.append($item);
        }
        $sec.append($grid);
        $g.append($sec);
    }

    // 统计在所有文件归集完成后更新
    $g.find('.gallery-count').text('共 ' + self.media.length + ' 个文件');

    self.initLightbox();
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
