#!/bin/sh
# ============================================================
# thumb-prewarm.sh - 后台预生成缩略图缓存
#
# 背景:
#   打开相册时,相机端需要现场跑 ImageMagick convert 生成缩略图,
#   单核 ARM 上约 0.5-2s/张。几百张照片时首屏要等几分钟,期间 CPU
#   打满,80 端口 daemon 的心跳被饿死,前端还会误报"相机已断开"。
#
# 作用:
#   在后台提前把缓存铺好(优先级最低,不影响拍摄与遥控),
#   浏览时全部命中缓存 -> 秒开,CPU 也不再有尖峰。
#
# 用法(相机端):
#   thumb-prewarm.sh start [宽度] [质量] [最多张数]   # 后台开始预热
#   thumb-prewarm.sh stop                            # 停止
#   thumb-prewarm.sh status                          # 查看进度
#
# 例:
#   thumb-prewarm.sh start 400 82 300   # 预热最新 300 张,400px/q82
#   thumb-prewarm.sh start              # 默认 400 82 200
#
# 开机自启(写到 auto/a_init.sh 末尾):
#   /opt/usr/nx-ks/nx-rc/thumb/thumb-prewarm.sh start &
# ============================================================

TOOLS=/opt/usr/nx-ks/tools
CONVERT=$TOOLS/usr/bin/convert
LD_LIBRARY_PATH=$TOOLS/usr/lib
export LD_LIBRARY_PATH

PIDFILE=/tmp/thumb_prewarm.pid
LOGFILE=/tmp/thumb_prewarm.log

# ---- 定位 SD 卡 ----
SD=""
for cand in /mnt/mmc /tmp/mmc /mnt/sd /tmp/sd; do
    if [ -d "$cand/DCIM" ]; then
        SD=$cand
        break
    fi
done

log() {
    echo "$(date '+%H:%M:%S') $1" >> "$LOGFILE"
}

case "$1" in
    stop)
        if [ -f "$PIDFILE" ]; then
            kill "$(cat "$PIDFILE")" 2>/dev/null
            rm -f "$PIDFILE"
            log "stopped by user"
        fi
        echo "thumb-prewarm stopped"
        exit 0
        ;;
    status)
        if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
            echo "running (pid $(cat "$PIDFILE"))"
        else
            echo "not running"
        fi
        echo "--- last log ---"
        tail -5 "$LOGFILE" 2>/dev/null
        exit 0
        ;;
esac

# ---- start ----
W=${2:-400}
Q=${3:-82}
LIMIT=${4:-200}

[ -d "$SD/DCIM" ] || { echo "SD card / DCIM not found"; exit 1; }
[ -x "$CONVERT" ] || { echo "convert not found: $CONVERT"; exit 1; }

if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    echo "already running (pid $(cat "$PIDFILE"))"
    exit 0
fi

: > "$LOGFILE"
log "start: w=$W q=$Q limit=$LIMIT"

# 后台执行
(
    echo $$ > "$PIDFILE"
    CACHE_ROOT="$SD/.thumbcache/${W}x${Q}"
    DONE=0
    SKIP=0

    # 目录倒序 + 目录内文件名倒序 = 最新照片优先预热
    for d in $(ls -1r "$SD/DCIM" 2>/dev/null); do
        [ "$DONE" -ge "$LIMIT" ] && break
        DD="$SD/DCIM/$d"
        [ -d "$DD" ] || continue
        for f in $(ls -1r "$DD" 2>/dev/null); do
            [ "$DONE" -ge "$LIMIT" ] && break
            case "$f" in
                *.JPG|*.jpg|*.JPEG|*.jpeg|*.PNG|*.png) ;;
                *) continue ;;
            esac
            SRC="$DD/$f"
            [ -f "$SRC" ] || continue
            REL="$d/${f%.*}"
            CACHE="$CACHE_ROOT/$REL.jpg"

            # 已缓存且未过期则跳过
            if [ -f "$CACHE" ] && [ ! "$SRC" -nt "$CACHE" ]; then
                SKIP=$((SKIP + 1))
                continue
            fi

            mkdir -p "$(dirname "$CACHE")" 2>/dev/null
            TMP="$CACHE.tmp.$$"
            rm -f "$TMP"
            # nice -n 19:让位给拍摄/遥控,避免抢占 CPU
            if command -v nice >/dev/null 2>&1; then
                nice -n 19 "$CONVERT" -define "jpeg:size=${W}x${W}" \
                    -auto-orient -thumbnail "${W}x${W}" -quality "$Q" \
                    "$SRC" "$TMP" 2>/dev/null
            else
                "$CONVERT" -define "jpeg:size=${W}x${W}" \
                    -auto-orient -thumbnail "${W}x${W}" -quality "$Q" \
                    "$SRC" "$TMP" 2>/dev/null
            fi
            if [ -s "$TMP" ]; then
                mv -f "$TMP" "$CACHE" 2>/dev/null || rm -f "$TMP"
                DONE=$((DONE + 1))
                [ $((DONE % 20)) -eq 0 ] && log "generated $DONE (skipped $SKIP)"
            else
                rm -f "$TMP"
            fi
        done
    done

    log "finished: generated=$DONE skipped=$SKIP"
    rm -f "$PIDFILE"
) >> "$LOGFILE" 2>&1 &

sleep 1
echo "thumb-prewarm started (pid $(cat "$PIDFILE" 2>/dev/null))"
echo "progress: thumb-prewarm.sh status   log: $LOGFILE"
exit 0
