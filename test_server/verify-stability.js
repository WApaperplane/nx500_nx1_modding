/* ============================================================
 * verify-stability.js - 相册稳定性验证
 *
 * 验证两个修复:
 *   1. 缩略图请求并发限流(峰值 <= Gallery.MAX_CONCURRENT)
 *   2. 心跳去抖:连续失败未达阈值时只显示轻量提示条,不弹"已断开"
 *
 * 用法:
 *   NODE_PATH=<workspace>/node_modules node verify-stability.js
 * ============================================================ */
const { chromium } = require('playwright-core');

const BASE = 'http://127.0.0.1:8080';
const OUT = __dirname + '/shots';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

// 与 gallery.js 保持一致
const MAX_CONCURRENT = 2;

function ok(cond, msg) {
    console.log((cond ? '  [PASS] ' : '  [FAIL] ') + msg);
    return cond ? 0 : 1;
}

(async () => {
    let fails = 0;
    const browser = await chromium.launch({
        executablePath: EDGE,
        headless: true,
        args: ['--no-proxy-server', '--disable-gpu']
    });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.addInitScript(() => { window.prompt = () => '127.0.0.1:8080'; });

    // ---- 模拟相机端慢速缩略图生成(600ms/张) ----
    await page.route(/\/cgi-bin\/thumb/, async route => {
        await new Promise(r => setTimeout(r, 600));
        await route.continue();
    });

    // ---- 心跳:前 2 次失败,之后恢复(模拟 CPU 被占满的短暂抖动)----
    // 注意:必须用正则,glob 的 ** 在跨 host 匹配上不可靠
    let statusHits = 0;
    await page.route(/\/api\/v1\/camera\/status/, async route => {
        statusHits++;
        if (statusHits <= 2) {
            await route.abort('timedout');
        } else {
            await route.continue();
        }
    });

    // ---- 并发峰值统计 ----
    let inflight = 0, peak = 0, total = 0;
    page.on('request', r => {
        if (r.url().includes('/cgi-bin/thumb')) {
            inflight++; total++;
            if (inflight > peak) peak = inflight;
        }
    });
    const release = r => {
        if (r.url().includes('/cgi-bin/thumb')) inflight--;
    };
    page.on('requestfinished', release);
    page.on('requestfailed', release);

    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);

    console.log('\n=== 1. 心跳去抖:连续 2 次失败只提示,不弹"已断开" ===');
    await page.click('a[href="#gallery"]');
    await page.waitForSelector('.gallery-item', { timeout: 20000 });
    // 相册页心跳间隔 6s,等足够久让 2 次失败发生
    await page.waitForTimeout(14000);

    const s1 = await page.evaluate(() => {
        const c = app.controllers['127.0.0.1:8080'];
        return {
            failCount: c ? c.failCount : -1,
            modalVisible: $('#disconnectedModal').is(':visible'),
            warnVisible: $('#connWarning').hasClass('show'),
            warnText: $('#connWarning').text().trim()
        };
    });
    console.log('  status 请求次数:', statusHits, ' 连续失败计数:', s1.failCount);
    console.log('  提示条文案:', s1.warnText || '(空)');
    fails += ok(statusHits >= 2, '心跳确实被拦截失败过(前置条件成立)');
    fails += ok(!s1.modalVisible, '未达阈值时不弹"已断开"弹窗');
    fails += ok(s1.warnVisible, '未达阈值时显示轻量提示条');

    // ---- 心跳恢复后:提示条消失、失败计数归零 ----
    await page.waitForTimeout(8000);
    const s2 = await page.evaluate(() => {
        const c = app.controllers['127.0.0.1:8080'];
        return {
            failCount: c ? c.failCount : -1,
            modalVisible: $('#disconnectedModal').is(':visible'),
            warnVisible: $('#connWarning').hasClass('show')
        };
    });
    console.log('\n=== 2. 心跳恢复后 ===');
    console.log('  连续失败计数:', s2.failCount, ' 提示条可见:', s2.warnVisible);
    fails += ok(!s2.modalVisible, '恢复后仍无断开弹窗');
    fails += ok(s2.failCount === 0, '恢复后失败计数归零');
    fails += ok(!s2.warnVisible, '恢复后轻量提示条自动消失');

    // ---- 展开所有目录,统计并发峰值 ----
    console.log('\n=== 3. 缩略图请求并发限流 ===');
    // 折叠模型下,把其余目录逐个展开以加载更多缩略图
    for (let i = 1; i < 3; i++) {
        await page.evaluate(n => $('.gallery-section').eq(n).find('.gallery-dir-head').click(), i);
        await page.waitForTimeout(1500);
    }
    // 滚动到底,让视口外图片尽量入队
    for (let i = 0; i < 3; i++) {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(1500);
    }
    await page.waitForTimeout(3000);

    console.log('  缩略图请求总数:', total);
    console.log('  并发峰值:', peak, '(上限', MAX_CONCURRENT + ')');
    fails += ok(peak <= MAX_CONCURRENT, '并发峰值 <= ' + MAX_CONCURRENT);
    fails += ok(total > 0, '缩略图请求确实发出过');

    // ---- 加载完成情况 ----
    const s3 = await page.evaluate(() => {
        const imgs = Array.from(document.querySelectorAll('.gallery-item img'));
        return {
            items: document.querySelectorAll('.gallery-item').length,
            withSrc: imgs.filter(i => i.getAttribute('src')).length,
            thumbSrcs: imgs.filter(i => (i.getAttribute('src') || '').includes('/cgi-bin/thumb')).length,
            expanded: $('.gallery-grid:visible').length
        };
    });
    console.log('\n=== 4. 渲染与加载 ===');
    console.log('  ' + JSON.stringify(s3));
    fails += ok(s3.items > 0, '网格已渲染');
    fails += ok(s3.thumbSrcs === s3.withSrc && s3.withSrc > 0, '已加载项全部走缩略图 CGI');

    // ---- Lightbox ----
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(500);
    await page.click('.gallery-item');
    await page.waitForTimeout(2000);
    const lb = await page.evaluate(() => {
        const $el = $('.gallery-lightbox');
        if ($el.length === 0) {
            return null;
        }
        return {
            visible: $el.is(':visible'),
            counter: ($el.find('.gallery-lb-counter').text() || '').trim()
        };
    });
    console.log('\n=== 5. Lightbox ===');
    console.log('  ' + JSON.stringify(lb));
    fails += ok(lb && lb.visible, 'Lightbox 打开');

    await page.screenshot({ path: OUT + '/09-stability-final.png' });

    await browser.close();
    console.log('\n========================================');
    console.log(fails === 0 ? 'RESULT: ALL PASS' : 'RESULT: ' + fails + ' FAILED');
    process.exit(fails === 0 ? 0 : 1);
})().catch(e => {
    console.error('FAIL:', e.message);
    process.exit(1);
});
