import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
export const { chromium } = createRequire(new URL('../package.json', import.meta.url))('@playwright/test');
export const base = process.env.HMI_URL || 'http://127.0.0.1:4176/';
export const output = resolve(import.meta.dirname, '../.local/previews');
export async function launch() {
  await mkdir(output, { recursive: true });
  return chromium.launch({ headless: true, ...(process.env.HMI_CHROMIUM ? { executablePath: process.env.HMI_CHROMIUM } : {}) });
}
export async function open(page) {
  const errors = [], assets = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('response', response => { assets.push(response.url()); if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  const url = new URL(base); url.searchParams.set('test', '');
  await page.goto(url.href);
  await page.waitForFunction(() => document.body.dataset.ready === 'true' && !!globalThis.__hmi, null, { timeout: 45000 });
  return { errors, assets };
}
export const advance = (page, seconds, state = {}) => page.evaluate(({ seconds, state }) => __hmi.advance(seconds, state), { seconds, state });
export const snapshot = page => page.evaluate(() => { const s = __hmi.session; return { mode: s.mode, auto: s.auto, now: s.now, speed: s.hmi.view.speed.value, power: s.hmi.view.power, crc: s.store.stats.crcErrors, speedValid: s.hmi.view.speed.valid, rpmValid: s.hmi.view.rpm.valid, popup: s.hmi.view.popup?.code, dtcs: s.hmi.view.dtcs, camera: __hmi.world.cameraMode, settings: s.settings }; });
