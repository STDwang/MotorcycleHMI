import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Session, STEP, ENVIRONMENTS } from '../web/core/session.mjs';
import { parseDBC, SignalStore, encodeFrame } from '../web/core/can.mjs';
import { FAULTS } from '../web/core/ecu.mjs';

const text = readFileSync(new URL('../web/core/vehicle.dbc', import.meta.url), 'utf8');
const messages = parseDBC(text);
const run = (s, seconds, input = {}) => { for (let i = 0; i < Math.ceil(seconds / STEP); i++) s.step(input); };

for (const environment of Object.keys(ENVIRONMENTS)) {
  test(`shared session completes two ${environment} laps without crashes or leaving track`, () => {
    const s = new Session(messages, { mode: 'practice', environment });
    for (let i = 0; i < 120 * 260 && s.race.player.laps.length < 2; i++) s.step();
    assert.equal(s.race.player.laps.length, 2);
    assert.equal(s.crashes, 0); assert.equal(s.outside, 0);
    const sectors = s.race.player.lastSectors;
    assert.equal(sectors.length, 3);
    assert.ok(sectors.every(v => v.time > 10 && v.time < 60));
    assert.ok(Math.abs(sectors.reduce((sum, v) => sum + v.time, 0) - s.race.player.last) < STEP * 2);
  });
}

test('rookie throttle-only riding finishes a lap; pause freezes simulation and restart resets it', () => {
  const s = new Session(messages, { mode: 'practice', assist: 'rookie' }); s.takeOver();
  for (let i = 0; i < 120 * 150 && !s.race.player.laps.length; i++) s.step({ throttle: 1 });
  assert.equal(s.race.player.laps.length, 1); assert.equal(s.crashes, 0); assert.equal(s.outside, 0);
  s.paused = true; const now = s.now, distance = s.race.player.distance;
  run(s, 2, { throttle: 1 }); assert.equal(s.now, now); assert.equal(s.race.player.distance, distance);
  s.paused = false; s.step({ throttle: 1 }); assert.ok(s.now > now);
  s.start('practice'); assert.equal(s.now, 0); assert.equal(s.race.player.laps.length, 0);
});

test('shared bus honours every DBC cyclic deadline within ten percent', () => {
  const s = new Session(messages, { mode: 'bench' }), observed = new Map();
  s.bus.subscribe(frame => {
    const m = messages.get(frame.id);
    assert.ok(Math.abs(frame.period - m.cycle) <= m.cycle * .1 + 1e-6, `${m.name}: ${frame.period}ms vs ${m.cycle}ms`);
    observed.set(frame.id, (observed.get(frame.id) ?? 0) + 1);
  });
  run(s, 5); assert.equal(observed.size, messages.size);
  for (const message of messages.values()) assert.ok(observed.get(message.id) >= Math.floor(5000 / message.cycle) - 1);
});

const faultCodes = {
  bus_off: 'U0001', ecm_off: 'U0100', abs_off: 'U0121', imu_off: 'U0125', tpms_off: 'U0127', crc_abs: 'U0418',
  overheat: 'P0217', low_fuel: 'P0460', puncture: 'C0750', abs_fault: 'C0035', tcs_fault: 'C1210', oil: 'P0520', battery: 'P0562',
};
for (const name of Object.keys(FAULTS)) {
  test(`${name}: injection, acknowledgement, recovery, DTC history and clearing`, () => {
    const s = new Session(messages, { mode: 'bench' }); run(s, 4);
    s.setFault(name, true); run(s, name === 'puncture' ? 10 : 5);
    const code = faultCodes[name];
    assert.ok(s.hmi.view.alerts.some(a => a.code === code), `${name}: ${s.hmi.view.alerts.map(a => a.code)}`);
    if (name === 'bus_off') assert.deepEqual(s.hmi.view.alerts.map(a => a.code), ['U0001']);
    assert.equal(s.hmi.view.popup.code, code); assert.ok(s.hmi.acknowledge());
    s.step(); assert.equal(s.hmi.view.popup, null);
    assert.ok(s.hmi.view.alerts.some(a => a.code === code && a.acked));
    s.hmi.clearDTCs(); assert.ok(s.hmi.dtcs.some(d => d.code === code && d.active));
    s.setFault(name, false); run(s, 8);
    assert.equal(s.hmi.view.alerts.length, 0);
    assert.ok(s.hmi.dtcs.some(d => d.code === code && !d.active));
    s.hmi.clearDTCs(); assert.equal(s.hmi.dtcs.length, 0);
  });
}

test('ignition completes off, boot, check, run and powers down without phantom alerts', () => {
  const s = new Session(messages, { mode: 'bench' }); s.ecu.ignition = 0; run(s, .2);
  assert.equal(s.hmi.view.power, 'off');
  s.ecu.ignition = 2; run(s, .2); assert.equal(s.hmi.view.power, 'boot');
  run(s, 1.5); assert.equal(s.hmi.view.power, 'check');
  run(s, 1.6); assert.equal(s.hmi.view.power, 'run');
  s.ecu.ignition = 0; run(s, .2); assert.equal(s.hmi.view.power, 'off'); assert.equal(s.hmi.view.alerts.length, 0);
});

test('CAN rejects overlapping definitions, duplicate IDs, malformed and unknown frames; timeout recovers', () => {
  assert.throws(() => parseDBC(text.replace('BO_ 256', 'BO_ 4096')));
  assert.throws(() => parseDBC(text.replace('ThrottlePos : 16|8', 'ThrottlePos : 8|8')));
  assert.throws(() => parseDBC(text + '\nBO_ 256 DUPLICATE: 8 ECM\n'));
  const store = new SignalStore(messages), message = messages.values().next().value;
  assert.equal(store.read('EngineSpeed', 0), null);
  assert.equal(store.receive({ id: message.id, data: new Uint8Array(2) }, 0), false);
  assert.equal(store.receive({ id: 0x7ff, data: new Uint8Array(8) }, 0), false);
  assert.equal(store.receive(encodeFrame(message, { EngineSpeed: 4000 }), 0), true);
  assert.equal(store.read('EngineSpeed', message.timeout), 4000);
  assert.equal(store.read('EngineSpeed', message.timeout + 1), null);
  assert.equal(store.receive(encodeFrame(message, { EngineSpeed: 5000 }, 1), message.timeout + 2), true);
  assert.equal(store.read('EngineSpeed', message.timeout + 2), 5000);
});
