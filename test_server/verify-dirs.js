/* ============================================================
 * verify-dirs.js - 折叠目录模型验证
 *
 * 验证点:
 *   1. mock 出 10 个目录 -> 初次只发"根 + 默认展开目录"的目录页请求,
 *      不再像旧实现那样抓全部目录
 *   2. 点开其他目录才追加请求(按需加载)
 *   3. 切走页签再切回 -> 命中缓存,不再重新抓目录
 *   4. 目录序(最新在上)与目录内照片序(最新在前)
 *
 * 用法:
 *   NODE_PATH=<workspace>/node_modules node verify-dirs.js
 * ============================================================ */
const { chromium } = require('playwright-core');

const BASE = 'http://127.0.0.1:8080';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

// mock 根目录:10 个 PHOTO 目录(101..110)
function rootHtml() {
    let rows = '<html><body><h1>Index of /DCIM</h1><table>';
    for (let n = 101; n <= 110; n++) {
        rows += '<tr><td><a href="/DCIM/' + n + 'PHOTO/">[DIRECTORY]</a></td>' +
                '<td>' + n + 'PHOTO/</td></tr>';
    }
    return rows + '</table></body></html>';
}

// mock 单个目录页:8 张图(IMG_0001..IMG_0008),渲染顺序倒排
function dirHtml(dirName) {
    let rows = '<html><body><h1>Index of /' + dirName + '</h1><table>';
    for (let n = 1; n <= 8; n++) {
        const pad = ('0000' + n).slice(-4);
        rows += '<tr><td><a href="/DCIM/' + dirName + '/IMG_' + pad +
                '.JPG">IMG_' + pad + '.JPG</a></td><td>2MB</td></tr>';
    }
    return rows + '</table></body></html>';
}

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

    // 记录目录页请求(非缩略图/静态资源)
    const dirReqs = [];
    page.on('request', r => {
        const u = r.url();
        if (/\/DCIM\/\d+PHOTO\//.test(u) &&
            !/IMG_|\.css|\.js|favicon/.test(u)) {
            const m = u.match(/(\d+PHOTO)\//);
            dirReqs.push(m ? m[1] : u);
        }
    });

    // mock:根目录返回 10 个目录;具体目录页返回 8 张图
    // 注意 fetchDir 用 cache:false,jQuery 会给 URL 加 ?_= 防缓存,正则须容忍 query
    await page.route(/\/DCIM(\?|$)/, route =>
        route.fulfill({ status: 200, contentType: 'text/html', body: rootHtml() }));
    await page.route(/\/DCIM\/(\d+PHOTO)\/(\?|$)/, route => {
        const m = route.request().url().match(/(\d+PHOTO)\//);
        route.fulfill({ status: 200, contentType: 'text/html',
                        body: dirHtml(m ? m[1] : '') });
    });
    // 原图请求:直接 404(不关注原图本身)
    await page.route(/IMG_\d+\.JPG$/, route => route.fulfill({
        status: 404, contentType: 'text/plain', body: 'mock no orig'
    }));
    // 缩略图:fast 404 模拟未部署(避免真实 convert,本验证不看图)
    await page.route(/\/cgi-bin\/thumb/, route => route.fulfill({
        status: 404, contentType: 'text/plain', body: 'thumb off'
    }));

    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await page.click('a[href="#gallery"]');
    await page.waitForSelector('.gallery-section', { timeout: 20000 });
    await page.waitForTimeout(2000);

    console.log('\n=== 1. 初次加载:10 目录只应抓根+默认展开目录 ===');
    const s1 = await page.evaluate(() => ({
        sections: $('.gallery-section').length,
        expanded: $('.gallery-grid:visible').length,
        first: $('.gallery-section').eq(0).find('.gallery-dir-name').text(),
        last: $('.gallery-section').last().find('.gallery-dir-name').text(),
        items: $('.gallery-item').length
    }));
    console.log('  目录请求:', JSON.stringify(dirReqs));
    console.log('  分区数:', s1.sections, ' 展开数:', s1.expanded,
                ' 首目录:', s1.first, ' 末目录:', s1.last, ' 项:', s1.items);
    fails += ok(s1.sections === 10, '渲染出全部 10 个目录头');
    fails += ok(s1.first === '110PHOTO' && s1.last === '101PHOTO',
        '目录倒序(最新 110PHOTO 在最上)');
    fails += ok(dirReqs.length === 1 && dirReqs[0] === '110PHOTO',
        '目录页请求仅 1 次(默认展开最新 110PHOTO),不抓其他 9 个');
    fails += ok(s1.expanded === 1, '仅 1 个目录展开');
    fails += ok(s1.items === 8, '默认展开目录加载 8 项');

    console.log('\n=== 2. 目录内照片最新在前 ===');
    const img0 = await page.evaluate(() =>
        $('.gallery-grid:visible img').first().attr('data-src'));
    console.log('  首张缩略图:', (img0 || '').split('f=').pop());
    fails += ok((img0 || '').indexOf('IMG_0008.JPG') !== -1,
        '目录内首张为最新照片 IMG_0008(倒序)');

    console.log('\n=== 3. 按需点开第二个目录 ===');
    await page.evaluate(() => $('.gallery-section').eq(1).find('.gallery-dir-head').click());
    await page.waitForTimeout(1500);
    console.log('  目录请求(新增后):', JSON.stringify(dirReqs));
    fails += ok(dirReqs.length === 2 && dirReqs[1] === '109PHOTO',
        '点开后追加请求 109PHOTO(按需,仍不抓其余 8 个)');
    const items2 = await page.evaluate(() => $('.gallery-item').length);
    fails += ok(items2 === 16, '展开后共 16 项');

    console.log('\n=== 4. 切走再切回:命中缓存不重抓 ===');
    await page.click('a[href="#controller"]');
    await page.waitForTimeout(800);
    const before = dirReqs.length;
    await page.click('a[href="#gallery"]');
    await page.waitForTimeout(2000);
    console.log('  切回后目录请求:', JSON.stringify(dirReqs),
                '(原 ' + before + ' 次)');
    fails += ok(dirReqs.length === before, '切回后无新增目录请求(缓存命中)');
    const s4 = await page.evaluate(() => ({
        items: $('.gallery-item').length,
        expanded: $('.gallery-grid:visible').length
    }));
    fails += ok(s4.items === 16, '缓存重建后 16 项仍在');
    fails += ok(s4.expanded === 2, '展开状态保留(2 个 grid 可见)');

    await browser.close();
    console.log('\n========================================');
    console.log(fails === 0 ? 'RESULT: ALL PASS' : 'RESULT: ' + fails + ' FAILED');
    process.exit(fails === 0 ? 0 : 1);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
