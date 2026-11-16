import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { launch, open, output, advance } from './browser-utils.mjs';
const browser = await launch();
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const { errors } = await open(page);
  for (const environment of ['clear', 'dusk', 'rain']) {
    await page.locator('#settings-open').click(); await page.locator('#environment').selectOption(environment); await page.locator('#settings [data-close]').click();
    await page.locator('.session-nav [data-start="race"]').click();
    for (let i = 0; i < 50; i++) { const state = await advance(page, 15); if (state.state === 'finished') break; }
    const result = await page.evaluate(() => { const s = __hmi.session, p = s.race.player; return { environment: s.environment, state: s.race.state, laps: p.laps, crashes: s.crashes, outside: s.outside, position: p.position, entrants: s.race.entries.length }; });
    assert.equal(result.state, 'finished'); assert.equal(result.laps.length, 2); assert.equal(result.crashes, 0); assert.equal(result.outside, 0); assert.equal(result.entrants, 8);
    assert.equal(await page.locator('#finish-card').isVisible(), true); assert.equal(await page.locator('#classification li').count(), 8);
    await page.screenshot({ path: resolve(output, `finish-${environment}.png`) }); console.log('Two-lap race verified', result);
  }
  const audio = await page.evaluate(async () => {
    const { RideAudio } = await import('./audio.mjs'); const probe = new RideAudio(); await probe.enable();
    const analyser = probe.context.createAnalyser(); analyser.fftSize = 512; probe.master.connect(analyser);
    probe.update(6500, 90, .8, true); await new Promise(resolve => setTimeout(resolve, 1800));
    const data = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(data); const peak = Math.max(...data.map(Math.abs));
    probe.mute(); await new Promise(resolve => setTimeout(resolve, 1800)); analyser.getFloatTimeDomainData(data); const mutedPeak = Math.max(...data.map(Math.abs)); await probe.context.close(); return { peak, mutedPeak, state: probe.context.state, time: probe.context.currentTime };
  });
  console.log('Audio probe', audio); assert.ok(audio.peak > .001); assert.ok(audio.mutedPeak < audio.peak * .1); assert.deepEqual(errors, []); console.log('Synthesized audio and mute verified', audio);
} finally { await browser.close(); }
