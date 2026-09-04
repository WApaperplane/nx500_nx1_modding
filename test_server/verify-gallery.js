/* 相册缩略图优化验证(历史版本,面向"滚动分批加载"旧架构):
 * 1. 打开页面 -> 切相册 tab -> 等待网格渲染
 * 2. 检查缩略图 src 指向 /cgi-bin/thumb(而非原图)
 * 3. 检查首屏分批渲染数量(BATCH=30)与视口加载
 * 4. 滚动触发后续批次,验证分批加载与加载完毕
 * 5. 视口外图片 src 释放(IO 卸载)
 * 6. Lightbox 打开加载原图
 *
 * !!! 已过时(2026-09-04):相册改为"折叠目录,最新在前"模型,
 *     本脚本的滚动分批/loadAll 断言不再适用。
 *     现行验证请用 verify-dirs.js(目录折叠/按需加载/缓存)
 *     与 verify-stability.js(心跳去抖/并发限流/Lightbox)。
 */
const { chromium } = require('playwright-core');

const BASE = 'http://127.0.0.1:8080/';
const OUT = 'D:/download/NX-KS2-88/test_server/shots';

(async () => {
    const browser = await chromium.launch({
        executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
        headless: true,
        args: ['--no-proxy-server', '--disable-gpu']
    });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    // app.js 对 localhost 会 prompt 输入相机 IP(需带端口,测试服务器在 8080)
    await page.addInitScript(() => { window.prompt = () => '127.0.0.1:8080'; });

    const errors = [];
    const failedReq = [];
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !m.text().includes('favicon')) errors.push('console: ' + m.text()); });
    page.on('response', r => { if (r.status() >= 400) failedReq.push(r.status() + ' ' + r.url()); });

    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.click('a[href="#gallery"]');
    await page.waitForSelector('.gallery-item', { timeout: 20000 });
    await page.waitForTimeout(2500); // 等首批缩略图加载

    // ---- 1. 首批渲染 + 缩略图 URL 检查 ----
    const first = await page.evaluate(() => {
        const imgs = Array.from(document.querySelectorAll('.gallery-item img'));
        const withSrc = imgs.filter(i => i.getAttribute('src'));
        const srcs = withSrc.map(i => i.getAttribute('src'));
        return {
            items: document.querySelectorAll('.gallery-item').length,
            imgs: imgs.length,
            withSrc: withSrc.length,
            thumbSrcs: srcs.filter(s => s.indexOf('/cgi-bin/thumb') !== -1).length,
            origSrcs: srcs.filter(s => s.indexOf('/DCIM/') !== -1 && s.indexOf('cgi-bin') === -1).length,
            loaded: withSrc.filter(i => i.complete && i.naturalWidth > 0).length,
            sampleThumb: srcs[0] || null
        };
    });
    console.log('[1] 首批:', JSON.stringify(first));
    await page.screenshot({ path: OUT + '/06-gallery-top.png' });

    // ---- 2. 循环滚动触发全部分批加载 ----
    for (let i = 0; i < 10; i++) {
        const st = await page.evaluate(() => ({
            items: document.querySelectorAll('.gallery-item').length,
            loadAll: !!document.querySelector('.gallery-load-all'),
            scrollY: window.scrollY,
            scrollH: document.body.scrollHeight
        }));
        console.log('[2.' + (i + 1) + ']', JSON.stringify(st));
        if (st.loadAll) break;
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(800);
    }

    const done = await page.evaluate(() => ({
        items: document.querySelectorAll('.gallery-item').length,
        sections: document.querySelectorAll('.gallery-section').length,
        loadAll: !!document.querySelector('.gallery-load-all'),
        total: document.querySelector('.gallery-count') ? document.querySelector('.gallery-count').textContent : null
    }));
    console.log('[3] 全部加载:', JSON.stringify(done));
    await page.screenshot({ path: OUT + '/07-gallery-all.png', fullPage: true });

    // ---- 3. 视口内存释放:滚回顶部,检查远处图片 src 是否被清空 ----
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(1200);
    const release = await page.evaluate(() => {
        const imgs = Array.from(document.querySelectorAll('.gallery-item img'));
        const withSrc = imgs.filter(i => i.getAttribute('src')).length;
        const firstRowLoaded = imgs.slice(0, 8).filter(i => i.getAttribute('src')).length;
        const lastRowSrc = imgs.slice(-8).filter(i => i.getAttribute('src')).length;
        return { imgs: imgs.length, withSrc, firstRowLoaded, lastRowSrc };
    });
    console.log('[4] 视口释放(顶部已加载,远处应少):', JSON.stringify(release));

    // ---- 4. 点击缩略图打开 Lightbox(原图) ----
    await page.click('.gallery-item img');
    await page.waitForSelector('#galleryLightbox:visible', { timeout: 10000 });
    await page.waitForTimeout(1500);
    const lb = await page.evaluate(() => {
        const img = document.querySelector('#galleryLightbox .gallery-lb-image');
        return {
            visible: getComputedStyle(document.querySelector('#galleryLightbox')).display !== 'none',
            src: img ? img.getAttribute('src') : null,
            loaded: img ? (img.complete && img.naturalWidth > 0) : false,
            counter: document.querySelector('.gallery-lb-counter') ? document.querySelector('.gallery-lb-counter').textContent : null
        };
    });
    console.log('[5] Lightbox:', JSON.stringify(lb));
    await page.screenshot({ path: OUT + '/08-gallery-lightbox.png' });

    console.log('JS ERRORS:', errors.length ? JSON.stringify(errors) : 'none');
    console.log('FAILED REQUESTS:', failedReq.length ? JSON.stringify(failedReq) : 'none');
    await browser.close();
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
