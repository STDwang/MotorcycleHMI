import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { launch, open, output, base, advance, snapshot } from './browser-utils.mjs';
const browser = await launch();
let count = 0;
try {
  for (const [name, width, height] of [['desktop', 1600, 1000], ['tablet', 768, 1024], ['mobile', 390, 844]]) {
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: width < 900, acceptDownloads: true });
    const page = await context.newPage(); const { errors, assets } = await open(page);
    await advance(page, 4); assert.equal((await snapshot(page)).mode, 'demo'); count++;
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name} horizontal overflow`); count++;
    await page.keyboard.press('w'); assert.equal((await snapshot(page)).auto, false); assert.equal((await snapshot(page)).mode, 'practice'); count++;
    await page.keyboard.down('w'); const old = (await snapshot(page)).now; await page.waitForFunction(old => __hmi.session.now > old + 300, old); await page.keyboard.up('w'); count++;
    await page.locator('#pause').click(); const frozen = (await snapshot(page)).now; await advance(page, 1); assert.equal((await snapshot(page)).now, frozen); await page.locator('#pause').click(); count++;
    for (const mode of ['race', 'practice', 'bench']) { await page.locator(`.session-nav [data-start="${mode}"]`).click(); assert.equal((await snapshot(page)).mode, mode); } count++;
    await advance(page, 4); assert.equal((await snapshot(page)).power, 'run'); count++;
    const speed = page.locator('[data-bench="speed"]'); await speed.fill('187'); await speed.dispatchEvent('input'); await advance(page, 1); assert.equal(Math.round((await snapshot(page)).speed), 187); count++;
    await page.locator('#engineering-close').click();
    for (const mode of ['ROAD', 'SPORT', 'RAIN']) { await page.locator(`[data-mode="${mode}"]`).click(); await advance(page, .2); assert.equal(await page.evaluate(() => __hmi.session.hmi.view.mode), mode); } count++;
    await page.locator('#engineering-open').click();
    await page.locator('[data-fault="crc_abs"]').check(); await advance(page, 1); assert.ok((await snapshot(page)).crc > 0); assert.equal((await snapshot(page)).speedValid, false); assert.equal((await snapshot(page)).popup, 'U0418'); count++;
    await page.locator('#faults-clear').click(); await advance(page, 2); assert.equal((await snapshot(page)).speedValid, true); count++;
    await page.locator('[data-fault="ecm_off"]').check(); await advance(page, 1); assert.equal((await snapshot(page)).rpmValid, false); assert.equal((await snapshot(page)).popup, 'U0100'); count++;
    await page.locator('#faults-clear').click(); await advance(page, 2); assert.equal((await snapshot(page)).rpmValid, true); count++;
    await page.locator('[data-fault="bus_off"]').check(); await advance(page, 1); assert.equal((await snapshot(page)).popup, 'U0001'); count++;
    await page.locator('#faults-clear').click(); await advance(page, 2); assert.equal((await snapshot(page)).speedValid, true); count++;
    await page.locator('[data-tab="trace"]').click(); await page.locator('#trace-pause').click(); const trace = await page.locator('#trace-body').innerText(); await advance(page, 1); assert.equal(await page.locator('#trace-body').innerText(), trace); count++;
    await page.locator('#trace-filter').selectOption('288'); assert.ok((await page.locator('#trace-body tr').allTextContents()).every(row => row.startsWith('120 /'))); count++;
    await page.locator('#trace-pause').click(); await page.locator('[data-tab="signals"]').click(); assert.ok(await page.locator('#signals tr').count() > 50); count++;
    await page.locator('[data-tab="dtc"]').click(); assert.match(await page.locator('#dtcs').innerText(), /U0001/); await page.locator('#clear-dtcs').click(); await advance(page, .2); assert.equal((await snapshot(page)).dtcs.length, 0); count++;
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#export').click()]); assert.equal(download.suggestedFilename(), 'apex-diagnostics.json'); count++;
    await page.locator('#engineering-close').click(); await page.locator('#settings-open').click();
    await page.locator('#language').selectOption('en'); await page.locator('#units').selectOption('imperial'); await page.locator('#theme').selectOption('night'); await page.locator('#settings [data-close]').click(); await advance(page, .5);
    assert.equal((await snapshot(page)).settings.lang, 'en'); assert.equal((await snapshot(page)).settings.units, 'imperial'); assert.equal(await page.evaluate(() => __hmi.session.hmi.view.night), true); count++;
    await page.locator('#sound').click(); assert.equal(await page.locator('#sound').getAttribute('aria-pressed'), 'true'); await page.locator('#sound').click(); assert.equal(await page.locator('#sound').getAttribute('aria-pressed'), 'false'); count++;
    await page.locator('.session-nav [data-start="demo"]').click(); await advance(page, 4);
    if (width < 900) { const pedal = page.locator('[data-touch="throttle"]'); await pedal.scrollIntoViewIfNeeded(); const box = await pedal.boundingBox(); await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); assert.equal((await snapshot(page)).auto, false); await page.mouse.up(); await page.locator('.session-nav [data-start="demo"]').click(); } count++;
    await advance(page, 4);
    for (const camera of ['chase', 'cockpit', 'cluster', 'cinema']) { assert.equal((await snapshot(page)).camera, camera); await page.waitForTimeout(100); await page.screenshot({ path: resolve(output, `${name}-${camera}.png`), fullPage: true }); await page.locator('#camera').click(); } count++;
    assert.deepEqual(errors, [], `${name}: JavaScript / console / HTTP errors`); assert.ok(assets.every(url => new URL(url).origin === new URL(base).origin), 'no external runtime assets'); count++;
    console.log(`${name}: passed; ${await page.locator('#performance').innerText()}`); await context.close();
  }
  console.log(`${count} browser acceptance groups passed`);
} finally { await browser.close(); }
