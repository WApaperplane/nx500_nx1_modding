function Settings(macAddress) {
    this.cameraId = macAddress;
}

Settings.init = function () {
    var li = $('<li></li>')
        .append($('<a href="#"></a>')
                .append('录像时关闭屏幕 ' +
                        '<span id="screenOffOnRecordCheck" ' +
                        '      class="glyphicon glyphicon-ok"></span>'))
        .click(function () {
            var screenOffOnRecord = Settings.getScreenOffOnRecord();
            if (screenOffOnRecord) {
                $('#screenOffOnRecordCheck').hide();
                Settings.setScreenOffOnRecord(false);
            } else {
                $('#screenOffOnRecordCheck').show();
                Settings.setScreenOffOnRecord(true);
            }
        });

    // 触屏手势模式:off(关闭) / focus(轻点对焦+双击拍照) / shutter(轻点即拍)
    var touchModes = [
        {v: 'off',    label: '关闭'},
        {v: 'focus',  label: '轻点对焦'},
        {v: 'shutter', label: '轻点快门'}
    ];
    var touchLabels = {};
    var i;
    for (i = 0; i < touchModes.length; i++) {
        touchLabels[touchModes[i].v] = touchModes[i].label;
    }
    function setCheck() {
        if (Settings.getScreenOffOnRecord()) {
            $('#screenOffOnRecordCheck').show();
        } else {
            $('#screenOffOnRecordCheck').hide();
        }
    }
    var liTouch = $('<li></li>')
        .append($('<a href="#"></a>')
                .append('触屏手势: ' +
                        '<span id="touchGesturesCheck"></span>'))
        .click(function () {
            var cur = Settings.getTouchGestures();
            var next = null;
            for (i = 0; i < touchModes.length; i++) {
                if (touchModes[i].v === cur) {
                    next = touchModes[(i + 1) % touchModes.length].v;
                    break;
                }
            }
            if (next === null) {
                next = touchModes[0].v;
            }
            Settings.setTouchGestures(next);
            setTouchCheck();
        });
    function setTouchCheck() {
        $('#touchGesturesCheck').text(touchLabels[Settings.getTouchGestures()] ||
                                      touchLabels['off']);
    }
    $('#settingsMenu')
        .prepend(liTouch)
        .prepend(li)
        .click(function () {
            setCheck();
            setTouchCheck();
        });
    setCheck();
    setTouchCheck();
}

Settings.reset = function () {
    if (typeof(Storage) !== "undefined") {
        localStorage.clear();
    }
}

Settings.getScreenOffOnRecord = function () {
    return localStorage.getItem('screen_off_on_record') === 'true';
}

Settings.setScreenOffOnRecord = function (value) {
    if (value === true) {
        localStorage.setItem('screen_off_on_record', 'true');
    } else {
        localStorage.setItem('screen_off_on_record', 'false');
    }
}

Settings.getControlColSize = function () {
    return localStorage.getItem('control_col_size') || 'col-sm-4';
}

Settings.setControlColSize = function (value) {
    localStorage.setItem('control_col_size', value);
}

Settings.getNameByMacAddress = function (macAddress) {
    return localStorage.getItem(macAddress + '-name') || '';
}

Settings.prototype.getLiveView = function () {
    return localStorage.getItem(this.cameraId + '-liveview') || 'hq';
}

Settings.prototype.setLiveView = function (value) {
    localStorage.setItem(this.cameraId + '-liveview', value);
}

Settings.prototype.getOsd = function () {
    return localStorage.getItem(this.cameraId + '-osd') || 'show';
}

Settings.prototype.setOsd = function (value) {
    localStorage.setItem(this.cameraId + '-osd', value);
}

Settings.prototype.getName = function () {
    return localStorage.getItem(this.cameraId + '-name') || '';
}

Settings.prototype.setName = function (value) {
    localStorage.setItem(this.cameraId + '-name', value);
}

Settings.prototype.getColSize = function () {
    return localStorage.getItem(this.cameraId + '-col_size') || 'col-sm-8';
}
    
Settings.prototype.setColSize = function (value) {
    localStorage.setItem(this.cameraId + '-col_size', value);
}

Settings.prototype.getKeyInputEnabled = function () {
    return localStorage.getItem(this.cameraId + '-key_input_enabled') === 'true';
}

Settings.prototype.setKeyInputEnabled = function (value) {
    if (value === true) {
        localStorage.setItem(this.cameraId + '-key_input_enabled', 'true');
    } else {
        localStorage.setItem(this.cameraId + '-key_input_enabled', 'false');
    }
}

Settings.getTouchGestures = function () {
    return localStorage.getItem('touch_gestures') || 'focus';
}

Settings.setTouchGestures = function (value) {
    localStorage.setItem('touch_gestures', value);
}
