/* 三个新功能验证:相册批量下载 / 相机设置页 / 触屏手势 */
const { chromium } = require('playwright-core');

const BASE = 'http://127.0.0.1:8090/';
const OUT = 'D:/download/NX-KS2-88/test_server/shots';

(async () => {
    const browser = await chromium.launch({
        executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
        headless: true,
        args: ['--no-proxy-server', '--disable-gpu']
    });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.addInitScript(() => {
        window.prompt = () => '127.0.0.1:8090';
        localStorage.setItem('capdtm_port', '8090');
    });

    const errors = [];
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));

    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('.badge-chip', { timeout: 15000 });
    await page.waitForTimeout(800);

    // ===== 1. 相机设置页 =====
    await page.click('a[href="#cameraset"]');
    await page.waitForSelector('.camset-group', { timeout: 15000 });
    await page.waitForTimeout(800);
    const camset = await page.evaluate(() => ({
        groups: Array.from(document.querySelectorAll('.camset-group-title')).map(e => e.textContent),
        rows: document.querySelectorAll('.camset-row').length,
        selects: Array.from(document.querySelectorAll('.camset-select')).map(s => s.value),
        notice: document.querySelector('.camset-notice') ? document.querySelector('.camset-notice').textContent.trim() : ''
    }));
    console.log('CAMERA SETTINGS:', JSON.stringify(camset, null, 2));
    await page.screenshot({ path: OUT + '/06-camset.png' });

    // 修改一个参数(模拟保存)
    await page.selectOption('.camset-row[data-param="USERDATA_PW"] select', 'PW_RETRO');
    await page.waitForTimeout(800);
    const pwStatus = await page.evaluate(() =>
        document.querySelector('.camset-row[data-param="USERDATA_PW"] .camset-status').textContent);
    console.log('PW SET STATUS:', pwStatus);

    // ===== 2. 相册批量下载 =====
    await page.click('a[href="#gallery"]');
    await page.waitForSelector('.gallery-item img, .gallery-item .gallery-video-thumb', { timeout: 15000 });
    await page.waitForTimeout(1200);
    // 进入多选模式
    await page.click('.gallery-toolbar .btn-info:has-text("选择")');
    await page.waitForSelector('.gallery-item.selectable', { timeout: 5000 });
    // 全选
    await page.click('.gallery-toolbar .btn:has-text("全选")');
    await page.waitForTimeout(300);
    const sel = await page.evaluate(() => ({
        selectModeOn: document.querySelectorAll('.gallery-item.selectable').length,
        selected: document.querySelectorAll('.gallery-item.selected').length,
        btnText: Array.from(document.querySelectorAll('.gallery-toolbar .btn')).map(b => b.textContent.trim()).filter(t => t.includes('下载'))
    }));
    console.log('SELECT MODE:', JSON.stringify(sel));
    await page.screenshot({ path: OUT + '/07-gallery-select.png' });
    // 点"下载选中"验证开始下载(在 headless 中下载会触发,检查不报错即可)
    await page.click('.gallery-toolbar .btn:has-text("下载选中")');
    await page.waitForTimeout(1500);
    const dlInfo = await page.evaluate(() =>
        document.querySelector('.gallery-dl-info') ? document.querySelector('.gallery-dl-info').textContent : '');
    console.log('DOWNLOAD INFO:', dlInfo);

    // ===== 3. 触屏手势(切回控制器) =====
    await page.click('a[href="#controller"]');
    await page.waitForTimeout(1000);
    // 检查设置菜单有触屏手势项
    await page.click('.nav-tabs .pull-right:has-text("设置") a.dropdown-toggle');
    await page.waitForSelector('#touchGesturesCheck', { timeout: 5000 });
    const gestures = await page.evaluate(() => document.querySelector('#touchGesturesCheck').textContent);
    console.log('TOUCH GESTURE MODE:', gestures);
    // 点击切换模式
    await page.click('#settingsMenu li:has(#touchGesturesCheck) a');
    await page.waitForTimeout(300);
    const gestures2 = await page.evaluate(() => document.querySelector('#touchGesturesCheck').textContent);
    console.log('TOUCH GESTURE MODE AFTER CLICK:', gestures2);

    console.log('JS ERRORS:', errors.length ? errors : 'none');
    await browser.close();
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
