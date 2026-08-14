/* 诊断:点击相册 tab 后页面状态 */
const { chromium } = require('playwright-core');

(async () => {
    const browser = await chromium.launch({
        executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
        headless: true,
        args: ['--no-proxy-server', '--disable-gpu']
    });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    // 模拟相机 IP 输入(真实场景浏览器地址即为相机 IP,不会触发 prompt)
    await page.addInitScript(() => { window.prompt = () => '127.0.0.1:8080'; });

    page.on('pageerror', e => console.log('[PAGEERROR]', e.message));
    page.on('console', m => console.log('[CONSOLE:' + m.type() + ']', m.text()));

    await page.goto('http://127.0.0.1:8080/', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(500);

    const pre = await page.evaluate(() => ({
        hasApp: typeof app !== 'undefined',
        appHostname: typeof app !== 'undefined' ? app.hostname : null,
        galleryCreated: typeof app !== 'undefined' && !!app.gallery,
        tabs: document.querySelectorAll('.nav-tabs a').length
    }));
    console.log('PRE-CLICK:', JSON.stringify(pre));

    await page.click('a[href="#gallery"]');
    await page.waitForTimeout(1500);

    const post = await page.evaluate(() => ({
        activeTab: typeof app !== 'undefined' ? app.activeTab : null,
        galleryHtml: (document.getElementById('gallery') || {}).innerHTML ? document.getElementById('gallery').innerHTML.substring(0, 300) : 'EMPTY',
        galleryTabVisible: !!(document.querySelector('#gallery') && document.querySelector('#gallery').offsetParent)
    }));
    console.log('POST-CLICK:', JSON.stringify(post, null, 2));

    await browser.close();
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
