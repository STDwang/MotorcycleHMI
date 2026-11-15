import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const { chromium } = createRequire(new URL('../package.json', import.meta.url))('@playwright/test');
const base = process.env.HMI_URL || 'http://127.0.0.1:4176/';
const output = resolve(import.meta.dirname, '../previews'); await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
let count = 0;
try {
  for (const [name, width, height] of [['desktop', 1600, 1000], ['tablet', 768, 1024], ['mobile', 390, 844]]) {
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: width < 900, acceptDownloads: true });
    const page = await context.newPage(); const errors = [], assets = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { assets.push(response.url()); if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
    await page.goto(base);
    await page.waitForFunction(() => document.body.dataset.ready, null, { timeout: 45000 });
    assert.equal(await page.locator('body').getAttribute('data-ready'), 'true'); count++;
    assert.equal(await page.locator('#signals .signal').count(), 12); assert.equal(await page.locator('#frames .frame').count(), 3); count++;
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); count++;
    await page.locator('#start').click();
    await page.keyboard.down('w'); await page.waitForFunction(() => +document.querySelector('#speed').textContent > 20);
    await page.keyboard.up('w'); count++;
    await page.keyboard.down('d'); await page.waitForFunction(() => +document.body.dataset.lateral > .4);
    await page.keyboard.up('d'); count++;
    await page.keyboard.down('s'); await page.waitForFunction(() => document.querySelector('#speed').textContent === '0'); await page.keyboard.up('s'); count++;
    if (width < 600) { await page.locator('#dashboard-toggle').click(); assert.equal(await page.locator('#dashboard-toggle').getAttribute('aria-expanded'), 'true'); count++; }
    await page.locator('[data-mode="1"]').click(); await page.waitForFunction(() => document.querySelector('#mode-badge').textContent === 'SPORT'); count++;
    await page.locator('#beam').click(); await page.waitForFunction(() => document.querySelector('#beam-lamp').classList.contains('lit')); count++;
    await page.locator('#pause').click(); assert.equal(await page.locator('body').getAttribute('data-state'), 'paused');
    const before = await page.locator('body').getAttribute('data-distance'); await page.waitForTimeout(450);
    assert.equal(await page.locator('body').getAttribute('data-distance'), before); count++;
    await page.locator('#pause').click(); await page.locator('#cruise').click();
    await page.waitForFunction(() => +document.querySelector('#speed').textContent > 15); count++;
    await page.locator('[data-mode="2"]').click(); assert.match(await page.locator('#notice').innerText(), /被拦截/); count++;
    await page.locator('.faults summary').click();
    for (const [scenario, title] of [['tire', '胎压偏低'], ['overheat', '发动机温度过高'], ['abs', 'ABS 系统故障'], ['fuel', '燃油余量低']]) {
      await page.locator(`[data-scenario="${scenario}"]`).click();
      await page.waitForFunction(title => document.querySelector('#alert-title').textContent.includes(title), title); count++;
    }
    await page.locator('#acknowledge').click(); await page.waitForFunction(() => document.querySelector('#alert-title').textContent.includes('已确认')); count++;
    await page.locator('[data-scenario="offline"]').click();
    await page.waitForFunction(() => document.querySelector('#speed').textContent === '—');
    assert.equal(await page.locator('[data-signal="Speed"] .signal-value').getAttribute('data-quality'), 'stale'); count++;
    await page.locator('[data-scenario="normal"]').click();
    await page.waitForFunction(() => document.querySelector('#alert-title').textContent === '车辆状态正常'); count++;
    if (width < 600) await page.locator('#dashboard-toggle').click();
    if (width < 900) await page.locator('#telemetry-toggle').click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#export').click()]);
    assert.equal(download.suggestedFilename(), 'apex-ride-diagnostics.json'); count++;
    if (width < 900) await page.locator('#telemetry-toggle').click();
    await page.locator('#sound').click(); assert.equal(await page.locator('#sound').getAttribute('aria-pressed'), 'true'); count++;
    await page.locator('#sound').click(); assert.equal(await page.locator('#sound').getAttribute('aria-pressed'), 'false'); count++;
    await page.locator('#help').click(); assert.equal(await page.locator('#about').evaluate(el => el.open), true);
    assert.equal(await page.locator('body').getAttribute('data-state'), 'paused'); await page.locator('#close-help').click(); count++;
    await page.locator('#reset').click(); await page.waitForFunction(() => document.body.dataset.state === 'ready');
    assert.equal(await page.locator('#start-card').isVisible(), true); count++;
    if (width < 900) {
      await page.locator('#start').click(); const pedal = page.locator('[data-touch="throttle"]');
      // Use actual pointer events so pointer capture is meaningful.
      const box = await pedal.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
      await page.waitForFunction(() => +document.querySelector('#speed').textContent > 2);
      await page.mouse.up(); count++;
      await page.locator('#reset').click();
    }
    await page.locator('#start-auto').click(); await page.waitForFunction(() => +document.querySelector('#speed').textContent > 50);
    assert.ok(+(await page.locator('#rx').innerText()) > 100); count++;
    await page.screenshot({ path: resolve(output, `3d-${name}.png`) });
    assert.deepEqual(errors, [], `${name}: JS / HTTP errors`); count++;
    assert.ok(assets.every(url => new URL(url).origin === new URL(base).origin), 'no external runtime assets'); count++;
    assert.ok(!assets.some(url => /\.(glb|gltf|fbx|obj|mp3|ogg|wav|png|jpg)(\?|$)/i.test(url)), 'no model/texture/audio asset files'); count++;
    console.log(`${name}: passed; FPS ${await page.locator('#fps').innerText()}`); await context.close();
  }
  console.log(`${count} 3D game browser checks passed`);
} finally { await browser.close(); }
