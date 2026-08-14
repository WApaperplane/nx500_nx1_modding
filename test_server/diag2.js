/* 诊断:页面 JS 错误 */
const { chromium } = require('playwright-core');

(async () => {
    const browser = await chromium.launch({
        executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
        headless: true,
        args: ['--no-proxy-server', '--disable-gpu']
    });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.addInitScript(() => { window.prompt = () => '127.0.0.1:8090'; });
    page.on('pageerror', e => console.log('[PAGEERROR]', e.message));
    page.on('console', m => { if (m.type() === 'error') console.log('[CONSOLE]', m.text().substring(0, 200)); });

    await page.goto('http://127.0.0.1:8090/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);
    const state = await page.evaluate(() => ({
        hasApp: typeof app !== 'undefined',
        hasControllers: typeof app !== 'undefined' ? Object.keys(app.controllers).length : -1,
        appHostname: typeof app !== 'undefined' ? app.hostname : null,
        touchCheck: document.querySelector('#touchGesturesCheck') ? document.querySelector('#touchGesturesCheck').textContent : 'MISSING'
    }));
    console.log('STATE:', JSON.stringify(state));
    await browser.close();
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
