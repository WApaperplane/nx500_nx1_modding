/* ------------------------------------------------------------
 * 连接心跳参数
 *
 * 背景:WiFi 直连 + 相机单核 CPU 下,相册页并发拉取几十张缩略图会
 * 让相机端 ImageMagick 进程打满 CPU,导致 80 端口 daemon 的 status
 * 请求排队超时。旧逻辑"单次失败立刻弹断开弹窗"因此频繁假阳性
 * (表现为:弹窗说已断开,但点掉后图片照常加载)。
 *
 * 对策:连续失败累计到阈值才判定真断开;超时放宽;相册页降频。
 * ------------------------------------------------------------ */
NxRemoteController.STATUS_TIMEOUT = 8000;   // 单次请求超时(ms)
NxRemoteController.STATUS_INTERVAL = 1500;  // 控制页心跳间隔(ms)
NxRemoteController.STATUS_INTERVAL_GALLERY = 6000; // 相册页心跳间隔(ms)
NxRemoteController.FAIL_THRESHOLD = 3;      // 连续失败多少次才判定断开

function NxRemoteController(hostname) {
    this.hostname = hostname;
    this.viewFinder = null;
    this.urlPrefix = 'http://' + hostname;
    this.nxModelName = "NX1"; // FIXME: fallback
    this.nxFwVer = "";
    this.macAddress = "";
    this.modalEnabled = false;
    this.liveView = null;
    this.osd = null;
    this.mouseInput = null;
    this.statusTimer = null;
    this.settings = null;
    this.failCount = 0;    // 连续失败计数(成功即清零)
    this.warnShown = false;  // 轻量提示条是否已显示
    this.destroyed = false;  // 已销毁则停止心跳

    this.init();
}

NxRemoteController.prototype.createUrl = function (path) {
    return this.urlPrefix + path;
}

NxRemoteController.prototype.setVisibility = function () {
    if (this.isNx1()) {
        this.viewFinder.panel.target.find('.nx1-only').show();
    } else {
        this.viewFinder.panel.target.find('.nx1-only').hide();
    }
    if (this.isNx500()) {
        this.viewFinder.panel.target.find('.nx500-only').show();
    } else {
        this.viewFinder.panel.target.find('.nx500-only').hide();
    }
    if (this.isNx1() || this.isNx500()) {
        this.viewFinder.panel.target.find('.nx1-nx500-only').show();
    } else {
        this.viewFinder.panel.target.find('.nx1-nx500-only').hide();
    }
    if (this.isNx300()) {
        this.viewFinder.panel.target.find('.nx300-only').show();
    } else {
        this.viewFinder.panel.target.find('.nx300-only').hide();
    }
    if (!this.isNx1()) {
        this.viewFinder.panel.target.find('.not-nx1-only').show();
    } else {
        this.viewFinder.panel.target.find('.not-nx1-only').hide();
    }
}

NxRemoteController.prototype.getCameraInfo = function () {
    var self = this;
    $.ajax({
        url: self.createUrl('/api/v1/camera/info'),
        success: function (info) {
            self.nxModelName = info.model;
            self.nxFwVer = info.fw_ver;
            self.macAddress = info.mac_address;

            var text = 'NX 远程控制器 ' +
                       '[ ' + info.model + ' (固件 ' + info.fw_ver + ')]';
            document.title = text;

            self.settings = new Settings(self.macAddress);
            self.viewFinder = new ViewFinder(self);
            self.osd = new Osd(self);
            self.liveView = new LiveView(self);
            self.mouseInput = new MouseInput(self);

            self.setVisibility();
            self.controlLcd('on');
            // 用可变的 setTimeout 递归替代固定 setInterval:
            // 相册页需要拉长间隔,避免与缩略图请求争抢相机端资源。
            self.scheduleStatus();

            app.controlPanel.updateTitle();
            app.controlPanel.setVisibility();
        }
    });
}

NxRemoteController.prototype.isNx1 = function () {
    return this.nxModelName == 'NX1';
}

NxRemoteController.prototype.isNx500 = function () {
    return this.nxModelName == 'NX500';
}

NxRemoteController.prototype.isNx300 = function () {
    return this.nxModelName == 'NX300';
}

NxRemoteController.prototype.restartScreen = function () {
    var self = this;

    if (self.liveView != null && self.liveView.started == false) {
        var value = this.settings.getLiveView();
        if (value === "hq") {
            self.liveView.start(false); // restart hq liveview
        } else if (value === "lq") {
            self.liveView.start(true); // restart lq liveview
        } else if (value === "hide") {
            self.liveView.stop();
        }
    }
    if (self.osd != null && self.osd.started == false) {
        var value = this.settings.getOsd();
        if (value === "show") {
            self.osd.start(); // restart osd
        } else if (value === "hide") {
            self.osd.stop();
        }
    }
}

/* 调度下一次心跳(间隔随当前页签变化) */
NxRemoteController.prototype.scheduleStatus = function () {
    var self = this;
    if (self.statusTimer != null) {
        clearTimeout(self.statusTimer);
        self.statusTimer = null;
    }
    // 相册页会并发拉取大量缩略图,心跳降频,避免被饿死产生假阳性
    var gallery = (typeof app !== 'undefined' && app &&
                   app.getActiveTab && app.getActiveTab() == '#gallery');
    var interval = gallery ? NxRemoteController.STATUS_INTERVAL_GALLERY
                           : NxRemoteController.STATUS_INTERVAL;
    self.statusTimer = setTimeout(function () {
        self.statusTimer = null;
        self.getCameraStatus();
    }, interval);
};

/* 轻量连接提示条(非阻塞);仅在真正判定断开前出现 */
NxRemoteController.prototype.showConnWarning = function (show, text) {
    var $w = $('#connWarning');
    if ($w.length == 0) {
        $w = $('<div id="connWarning"></div>').appendTo('body');
    }
    if (show) {
        $w.html('<i class="fa fa-exclamation-triangle"></i> ' + text)
          .addClass('show');
        this.warnShown = true;
    } else {
        $w.removeClass('show');
        this.warnShown = false;
    }
};

NxRemoteController.prototype.getCameraStatus = function () {
    var self = this;
    // Tab 页被浏览器挂起/已销毁时不发请求
    if (self.destroyed) {
        return;
    }
    $.ajax({
        url: self.createUrl('/api/v1/camera/status'),
        timeout: NxRemoteController.STATUS_TIMEOUT,
        success: function(status) {
            var title = $('<span></span>')
                .click(function () {
                    self.ledBlink();
                });
            var html = '<span class="badge-chip"><i class="fa fa-camera"></i>' +
                       self.nxModelName + '</span>' +
                       '<span class="badge-chip"><i class="fa fa-signal"></i>' +
                       self.hostname + '</span>';
            var batteryIcon;
            var battClass = '';
            if (self.isNx1()) {
                if (status.battery_percent > 75) {
                    batteryIcon = '<i class="fa fa-battery-4"></i>';
                } else if (status.battery_percent > 50) {
                    batteryIcon = '<i class="fa fa-battery-3"></i>';
                } else if (status.battery_percent > 25) {
                    batteryIcon = '<i class="fa fa-battery-2"></i>';
                } else if (status.battery_percent > 10) {
                    batteryIcon = '<i class="fa fa-battery-1"></i>';
                } else {
                    batteryIcon = '<i class="fa fa-battery-0"></i>';
                    battClass = ' batt-low';
                }
                html += '<span class="badge-chip' + battClass + '">' +
                        batteryIcon + ' ' + status.battery_percent + '%' +
                        (status.battery_charging == true ?
                         ' <i class="fa fa-bolt"></i>' : '') + '</span>';
            } else {
                if (status.battery_level == 5) {
                    batteryIcon = '<i class="fa fa-battery-4"></i>';
                } else if (status.battery_level == 4) {
                    batteryIcon = '<i class="fa fa-battery-3"></i>';
                } else if (status.battery_level == 3) {
                    batteryIcon = '<i class="fa fa-battery-2"></i>';
                } else if (status.battery_level == 2) {
                    batteryIcon = '<i class="fa fa-battery-1"></i>';
                } else {
                    batteryIcon = '<i class="fa fa-battery-0"></i>';
                    battClass = ' batt-low';
                }
                html += '<span class="badge-chip' + battClass + '">' +
                        batteryIcon +
                        (status.battery_charging == true ?
                         ' <i class="fa fa-bolt"></i>' : '') + '</span>';
            }

            html += '<span class="badge-chip mode-chip">' +
                    '<i class="fa fa-sliders"></i>模式 ' + status.mode +
                    '</span>';

            self.viewFinder.panel.setTitle(title.html(html));

            if (status.hevc == 'on') {
                if (self.osd != null) {
                    self.osd.setTimeoutInterval(500);
                }
                if (self.liveView != null) {
                    self.liveView.setTimeoutInterval(500);
                }
                if (Settings.getScreenOffOnRecord()) {
                    self.stopScreen();
                }
            } else if (status.hevc == 'off') {
                if (self.osd != null) {
                    self.osd.setTimeoutInterval(50);
                }
                if (self.liveView != null) {
                    self.liveView.setTimeoutInterval(50);
                }
            }

            if (!self.viewFinder.panel.isCollapsed()
                    && app.getActiveTab() == '#controller') {
                if (status.hevc != 'on') {
                    self.restartScreen();
                } else if (!Settings.getScreenOffOnRecord()) {
                    self.restartScreen();
                }
            }

            for (var i = 0; i < status.cameras.length; i++) {
                var ip = status.cameras[i].ip;
                var model = status.cameras[i].packet.split('|')[2];
                status.cameras[i].model = model;
                status.cameras[i].macAddress =
                    status.cameras[i].packet.split('|')[4];
                app.setCameras(status.cameras);
            }
            self.failCount = 0;
            if (self.warnShown) {
                self.showConnWarning(false);
            }
            if (self.modalEnabled == true) {
                $('#disconnectedModal').modal('hide');
                self.modalEnabled = false;
            }
        },
        error: function (request, status, error) {
            if (self.destroyed) {
                return;
            }
            self.failCount++;

            // 未达阈值:只显示轻量提示条,不做任何阻塞/清理。
            // 相册页浏览时相机 CPU 被缩略图生成占满是常态,
            // 此时 status 超时不代表断开(图片仍在正常加载)。
            if (self.failCount < NxRemoteController.FAIL_THRESHOLD) {
                self.showConnWarning(true,
                    '相机响应缓慢,正在重试…(' + self.failCount + '/' +
                    NxRemoteController.FAIL_THRESHOLD + ')');
                return;
            }

            if (self.modalEnabled == false) {
                var hostname;
                var found = false;
                for (hostname in app.controllers) {
                    var controller = app.controllers[hostname];
                    if (controller.hostname == self.hostname) {
                        found = true;
                    }
                }
                if (!found) {
                    return;
                }

                var name = self.settings.getName();
                if (name == '') {
                    name = self.hostname;
                }
                self.showConnWarning(false);
                $('#disconnectedModalBody')
                    .html($('<p></p>').append(name + ' 已断开连接。'));
                $('#disconnectedModal').modal('show');
                self.modalEnabled = true;
                setTimeout(function() {
                    if (self.modalEnabled) {
                        app.removeController(self.hostname);
                        $('#disconnectedModal').modal('hide');
                        self.modalEnabled = false;
                    }
                }, 5000); // wait 5 second;
            }
        },
        complete: function () {
            // 无论成功失败都继续心跳(到达阈值的分支会自行销毁)
            self.scheduleStatus();
        }
    });
}

NxRemoteController.prototype.controlLcd = function (state) {
    var self = this;
    $.ajax({
        url: self.createUrl('/api/v1/lcd/' + state),
        mimeType: 'text/html',
        success: function(data) {
        }
    });
}

NxRemoteController.prototype.shutterSetSilent = function (silent) {
    var self = this;
    $.ajax({
        url: self.createUrl('/api/v1/shutter/' + (silent ? 'silent' : 'normal')),
        mimeType: 'text/html',
        success: function(data) {
        }
    });
}

NxRemoteController.prototype.ledSet = function (on) {
    var self = this;
    $.ajax({
        url: self.createUrl('/api/v1/led/' + (on ? "on" : "off")),
        mimeType: 'text/html',
        success: function(data) {
        }
    });
}

NxRemoteController.prototype.ledBlink = function () {
    var self = this;
    for (var ms = 0; ms < 2000; ms += 500) {
        setTimeout(function () {
            self.ledSet(true);
        }, ms);
        setTimeout(function () {
            self.ledSet(false);
        }, ms + 250);
    }
}

NxRemoteController.prototype.init = function () {
    var self = this;

    this.getCameraInfo();
    this.ledBlink();
}

NxRemoteController.prototype.stopScreen = function () {
    if (this.osd != null) {
        this.osd.stop();
    }
    if (this.liveView != null) {
        this.liveView.stop();
    }
}

NxRemoteController.prototype.destroy = function () {
    this.destroyed = true;
    if (this.osd != null) {
        this.osd.destroy();
        this.osd = null;
    }
    if (this.liveView != null) {
        this.liveView.destroy();
        this.liveView = null;
    }
    this.mouseInput = null;
    if (this.statusTimer != null) {
        clearTimeout(this.statusTimer);
        this.statusTimer = null;
    }
    this.showConnWarning(false);
    if (this.viewFinder != null) {
        this.viewFinder.destroy();
        this.viewFinder = null;
    }
}

NxRemoteController.prototype.isKeyInputEnabled = function () {
    if (this.settings != null) {
        return this.settings.getKeyInputEnabled();
    } else {
        return false;
    }
}

function showAndroidToast(msg) {
    Android.showToast(msg);
}
