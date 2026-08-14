/* 控制器界面美化验证:打开页面 -> 等待相机信息 -> 截图 + DOM 检查 */
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
    await page.addInitScript(() => { window.prompt = () => '127.0.0.1:8090'; });

    const errors = [];
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !m.text().includes('favicon')) errors.push('console: ' + m.text()); });

    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
    // 等待相机信息加载(状态徽章出现)
    await page.waitForSelector('.badge-chip', { timeout: 15000 });
    await page.waitForTimeout(1200);

    const info = await page.evaluate(() => ({
        title: document.title,
        navItems: Array.from(document.querySelectorAll('.nav-tabs > li > a, .nav-brand')).map(e => e.textContent.trim()).filter(Boolean),
        badges: Array.from(document.querySelectorAll('.panel-heading .badge-chip')).map(e => e.textContent.trim()),
        panels: Array.from(document.querySelectorAll('.panel')).map(p => p.className.split(' ').filter(c => c.startsWith('panel-')).join(' ')),
        hasShutter: !!document.querySelector('#button-shutter'),
        hasControl: !!document.querySelector('#controlPanel') && document.querySelector('#controlPanel').offsetParent !== null,
        selectpickers: document.querySelectorAll('.bootstrap-select').length
    }));
    console.log('UI INFO:', JSON.stringify(info, null, 2));

    await page.screenshot({ path: OUT + '/04-controller-top.png' });
    await page.screenshot({ path: OUT + '/04-controller-full.png', fullPage: true });

    // 模拟手机宽度
    await page.setViewportSize({ width: 420, height: 800 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: OUT + '/05-controller-mobile.png' });

    console.log('JS ERRORS:', errors.length ? errors : 'none');
    await browser.close();
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
