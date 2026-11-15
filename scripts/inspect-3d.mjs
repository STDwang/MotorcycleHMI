import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const { chromium } = createRequire(new URL('../package.json', import.meta.url))('@playwright/test');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.on('pageerror', error => console.log('PAGE ERROR', error.message));
  page.on('console', message => { if (message.type() === 'error') console.log('CONSOLE ERROR', message.text()); });
  await page.goto(process.env.HMI_URL || 'http://127.0.0.1:4176/');
  await page.waitForFunction(() => !!document.body.dataset.ready, { timeout: 30000 });
  console.log(await page.locator('body').getAttribute('data-ready'));
  await page.screenshot({ path: resolve(import.meta.dirname, '../previews/3d-start.png') });
  if (await page.locator('body').getAttribute('data-ready') === 'true') {
    await page.locator('[data-mode="1"]').click(); await page.locator('#start-auto').click();
    await page.waitForFunction(() => +document.querySelector('#speed').textContent >= 100);
    console.log('Three-digit layout', await page.evaluate(() => {
      const speed = document.querySelector('.speed-wrap>div:first-child').getBoundingClientRect();
      const gear = document.querySelector('.gear').getBoundingClientRect();
      if (speed.right > gear.left) throw new Error('Speed overlaps gear');
      return { speedRight: speed.right, gearLeft: gear.left };
    }));
    await page.screenshot({ path: resolve(import.meta.dirname, '../previews/3d-riding.png') });
    console.log('FPS', await page.locator('#fps').innerText(), 'distance', await page.locator('body').getAttribute('data-distance'));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: resolve(import.meta.dirname, '../previews/3d-mobile.png') });
  }
} finally { await browser.close(); }
