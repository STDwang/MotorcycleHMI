import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { launch, open, output, base, advance } from './browser-utils.mjs';
const browser = await launch();
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await page.goto(base);
  await page.waitForFunction(() => document.body.dataset.ready === 'true');
  const startup = await page.evaluate(() => ({ readyMs: performance.now(), bytes: performance.getEntriesByType('resource').reduce((n, r) => n + r.transferSize, 0), requests: performance.getEntriesByType('resource').length, testApiExposed: '__hmi' in globalThis }));
  assert.ok(startup.readyMs < 3000, 'first scene ready within 3 seconds'); assert.equal(startup.testApiExposed, false);
  console.log('Production startup', startup);
  const { errors } = await open(page); await advance(page, 5);
  for (const camera of ['chase', 'cockpit', 'cluster', 'cinema']) { await page.waitForTimeout(150); await page.screenshot({ path: resolve(output, `inspect-${camera}.png`), fullPage: true }); await page.locator('#camera').click(); }
  console.log({ errors, performance: await page.locator('#performance').innerText() });
} finally { await browser.close(); }
