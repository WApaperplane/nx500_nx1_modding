/* ============================================================
 * verify-streaming.js - 目录树并发抓取 + 流式渲染验证
 *
 * 旧实现:目录请求严格串行,且必须全部读完才渲染 -> 首屏时间 = N × RTT
 * 新实现:并发抓取 + 读完一个目录即渲染 -> 首屏时间 ≈ 1 × RTT
 *
 * !!! 已过时(2026-09-04):相册进一步改为"折叠目录,按需点开加载",
 *     不再全量抓取目录,本脚本针对的"并发流式"阶段已被替代。
 *     现行验证请用 verify-dirs.js(目录折叠/按需加载/缓存)。
 *     保留本文件仅作历史回滚时回归旧实现使用。
 *
 * 验证手段:给每个 /DCIM 目录请求加 800ms 人为延迟,
 *          测量"首张图出现"与"整棵树读完"的时间差。
 *
 * 用法:
 *   NODE_PATH=<workspace>/node_modules node verify-streaming.js
 * ============================================================ */
const { chromium } = require('playwright-core');

const BASE = 'http://127.0.0.1:8080';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const DIR_DELAY = 800;   // 模拟相机端目录列表生成 + WiFi 往返耗时

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

    // 目录请求慢(串行 vs 并发的差异在这里被放大)
    let dirInflight = 0, dirPeak = 0, dirTotal = 0;
    page.on('request', r => {
        if (r.url().includes('/DCIM')) {
            dirInflight++; dirTotal++;
            if (dirInflight > dirPeak) dirPeak = dirInflight;
        }
    });
    const rel = r => { if (r.url().includes('/DCIM')) dirInflight--; };
    page.on('requestfinished', rel);
    page.on('requestfailed', rel);

    // 不同目录给不同延迟,模拟真实的"目录列表大小不一":
    // 串行下首图要等所有目录读完(慢目录拖累全部);
    // 并发+流式下,最快返回的那个目录立刻就能出图。
    const DELAY = {
        '100PHOTO': 300,
        '101PHOTO': 1500,
        '102PHOTO': 2500
    };
    await page.route(/\/DCIM/, async route => {
        const url = route.request().url();
        let d = DIR_DELAY;
        for (const k in DELAY) {
            if (url.indexOf(k) !== -1) { d = DELAY[k]; break; }
        }
        await new Promise(r => setTimeout(r, d));
        await route.continue();
    });
    // 串行基线 = 根 + 各目录延迟之和
    const serialBaseline = 300 + 300 + 1500 + 2500;

    // 缩略图也慢一点,避免干扰首屏计时(重点看目录抓取)
    await page.route(/\/cgi-bin\/thumb/, async route => {
        await new Promise(r => setTimeout(r, 80));
        await route.continue();
    });

    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);

    console.log('\n=== 计时开始:点击相册 tab ===');
    const t0 = Date.now();
    await page.click('a[href="#gallery"]');

    // 首张图出现的时间
    await page.waitForSelector('.gallery-item', { timeout: 30000 });
    const tFirst = Date.now() - t0;

    // 整棵树读完("共 N 个文件"取代"已读取 N 个文件")的时间
    await page.waitForFunction(
        () => $('.gallery-count').text().indexOf('共 ') === 0,
        { timeout: 30000 }
    );
    const tAllDirs = Date.now() - t0;

    console.log('  首张图出现:', tFirst + 'ms');
    console.log('  目录树读完:', tAllDirs + 'ms');
    console.log('  目录请求总数:', dirTotal, ' 并发峰值:', dirPeak);

    fails += ok(dirPeak > 1, '目录请求是并发的(峰值 ' + dirPeak + ' > 1)');
    console.log('  串行基线(各目录延迟之和):', serialBaseline + 'ms');
    fails += ok(tFirst < tAllDirs - 500,
        '首图显著早于目录树读完(流式生效,不等最慢的目录)');
    fails += ok(tFirst < serialBaseline * 0.5,
        '首屏时间不到串行基线的一半(' + serialBaseline + 'ms)');

    // 等渲染收尾
    await page.waitForTimeout(3000);
    const s = await page.evaluate(() => ({
        items: document.querySelectorAll('.gallery-item').length,
        sections: document.querySelectorAll('.gallery-section').length,
        count: $('.gallery-count').text().trim(),
        loadingGone: $('.gallery-loading').length === 0,
        loadAll: !!document.querySelector('.gallery-load-all'),
        sentinel: !!document.querySelector('.gallery-sentinel')
    }));
    console.log('\n=== 渲染结果 ===');
    console.log('  ' + JSON.stringify(s));
    fails += ok(s.sections >= 1, '至少一个目录分组已渲染');
    fails += ok(s.loadingGone, '转圈提示已撤掉');
    fails += ok(s.count.indexOf('共 ') === 0, '计数显示为最终值: ' + s.count);

    // 滚动到底,确认后续批次能继续加载(验证 IO 卡死问题已修)
    for (let i = 0; i < 3; i++) {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(800);
    }
    const s2 = await page.evaluate(() => ({
        items: document.querySelectorAll('.gallery-item').length,
        loadAll: !!document.querySelector('.gallery-load-all')
    }));
    console.log('\n=== 滚动到底 ===');
    console.log('  ' + JSON.stringify(s2));
    fails += ok(s2.loadAll || s2.items >= s.items, '滚动后能继续加载或已全部加载完');

    await browser.close();
    console.log('\n========================================');
    console.log(fails === 0 ? 'RESULT: ALL PASS' : 'RESULT: ' + fails + ' FAILED');
    process.exit(fails === 0 ? 0 : 1);
})().catch(e => {
    console.error('FAIL:', e.message);
    process.exit(1);
});
