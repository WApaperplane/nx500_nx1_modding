/* 无头浏览器验证:打开模拟相机页面 -> 切到相册 tab -> 截图缩略图网格 -> 点击图片截图 Lightbox */
const { chromium } = require('playwright-core');

const BASE = 'http://127.0.0.1:8080/';
const OUT = 'D:/download/NX-KS2-88/test_server/shots';

(async () => {
    const browser = await chromium.launch({
        executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
        headless: true,
        args: ['--no-proxy-server', '--disable-gpu']
    });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    // 模拟相机 IP 输入(真实场景浏览器地址即为相机 IP,不会触发 prompt)
    await page.addInitScript(() => { window.prompt = () => '127.0.0.1:8080'; });

    const errors = [];
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

    // 1. 打开首页
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: OUT + '/01-home.png' });

    // 2. 点击相册 tab
    await page.click('a[href="#gallery"]');
    await page.waitForSelector('.gallery-loading', { timeout: 5000 }).catch(() => {});
    // 等待缩略图渲染
    await page.waitForSelector('.gallery-item img, .gallery-item .gallery-video-thumb', { timeout: 15000 });
    // 等所有可见图片加载完成
    await page.waitForFunction(() => {
        const imgs = Array.from(document.querySelectorAll('.gallery-item img'));
        const visible = imgs.slice(0, 20);
        return visible.length > 0 && visible.every(i => i.complete);
    }, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(1500);
    await page.screenshot({ path: OUT + '/02-gallery-grid.png' });

    // 输出网格统计
    const info = await page.evaluate(() => ({
        groups: document.querySelectorAll('.gallery-section').length,
        items: document.querySelectorAll('.gallery-item').length,
        count: document.querySelector('.gallery-count') ? document.querySelector('.gallery-count').textContent : '',
        dirNames: Array.from(document.querySelectorAll('.gallery-dir-name')).map(e => e.textContent)
    }));
    console.log('GALLERY INFO:', JSON.stringify(info, null, 2));

    // 3. 点击第一张缩略图 -> Lightbox
    await page.click('.gallery-item img');
    await page.waitForSelector('#galleryLightbox:visible', { timeout: 5000 });
    await page.waitForFunction(() => {
        const img = document.querySelector('#galleryLightbox .gallery-lb-image');
        return img && img.complete && img.naturalWidth > 0;
    }, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(800);
    await page.screenshot({ path: OUT + '/03-lightbox.png' });

    const lb = await page.evaluate(() => {
        const img = document.querySelector('#galleryLightbox .gallery-lb-image');
        return {
            counter: document.querySelector('.gallery-lb-counter').textContent,
            natural: img.naturalWidth + 'x' + img.naturalHeight,
            shown: img.clientWidth + 'x' + img.clientHeight,
            stage: (() => { const s = document.querySelector('.gallery-lb-stage'); return s.clientWidth + 'x' + s.clientHeight; })()
        };
    });
    console.log('LIGHTBOX INFO:', JSON.stringify(lb, null, 2));

    // 4. 切换下一张
    await page.click('.gallery-lb-next');
    await page.waitForTimeout(1200);
    const lb2 = await page.evaluate(() => document.querySelector('.gallery-lb-counter').textContent);
    console.log('AFTER NEXT:', lb2);

    // 5. 关闭 Lightbox
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    const closed = await page.evaluate(() => !document.querySelector('#galleryLightbox').offsetParent);
    console.log('LIGHTBOX CLOSED by Esc:', closed);

    console.log('JS ERRORS:', errors.length ? errors : 'none');
    await browser.close();
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
