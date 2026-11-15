import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const { chromium } = createRequire(new URL('../package.json', import.meta.url))('@playwright/test');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(process.env.HMI_URL || 'http://127.0.0.1:4176/');
  await page.waitForFunction(() => document.body.dataset.ready === 'true');
  await page.locator('[data-mode="1"]').click(); await page.locator('#start-auto').click();
  const audio = await page.evaluate(async () => {
    const { RideAudio } = await import('./audio.mjs'); const probe = new RideAudio(); await probe.enable();
    const analyser = probe.context.createAnalyser(); analyser.fftSize = 512; probe.master.connect(analyser);
    probe.update(6500, 90, .8, true); await new Promise(resolve => setTimeout(resolve, 1500));
    const data = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(data);
    const peak = Math.max(...data.map(Math.abs)); probe.mute();
    await new Promise(resolve => setTimeout(resolve, 450)); analyser.getFloatTimeDomainData(data);
    const mutedPeak = Math.max(...data.map(Math.abs)); await probe.context.close();
    return { peak, mutedPeak, state: probe.context.state, enabled: probe.enabled, time: probe.context.currentTime };
  });
  console.log('Audio probe', audio);
  assert.ok(audio.peak > .001); assert.ok(audio.mutedPeak < audio.peak * .1);
  console.log('Web Audio synthesis signal and mute verified', audio);
  for (let checkpoint = 1; checkpoint <= 4; checkpoint++) {
    await page.waitForFunction(checkpoint => +document.querySelector('#checkpoint').textContent.split('/')[0] >= checkpoint, checkpoint, { timeout: 80000 });
    await page.screenshot({ path: resolve(import.meta.dirname, `../previews/3d-sector-${checkpoint}.png`) });
    console.log(`Checkpoint ${checkpoint} passed`);
  }
  assert.equal(await page.locator('#finish-card').isVisible(), true);
  assert.match(await page.locator('#best-time').innerText(), /巡航/);
  assert.equal(await page.evaluate(() => localStorage.getItem('apex.best.alpine.v2')), null);
  assert.deepEqual(errors, []);
  console.log('Complete 3D lap, 4 checkpoints, result, cruise exclusion and sound verified');
} finally { await browser.close(); }
