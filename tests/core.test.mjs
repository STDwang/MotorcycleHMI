import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Track } from '../web/core/track.mjs';
import { Bike } from '../web/core/bike.mjs';
import { Race } from '../web/core/race.mjs';
import { parseDBC, encodeFrame, decodeFrame, crc8, CanBus, SignalStore } from '../web/core/can.mjs';
import { Electronics } from '../web/core/ecu.mjs';
import { ClusterModel } from '../web/hmi/model.mjs';

const track = new Track();
const dbc = () => parseDBC(readFileSync(new URL('../web/core/vehicle.dbc', import.meta.url), 'utf8'));

function rig() {
  const messages = dbc(), bus = new CanBus(messages), store = new SignalStore(messages), ecu = new Electronics(), hmi = new ClusterModel(store);
  bus.subscribe((frame, now) => store.receive(frame, now));
  const bike = new Bike(track, { assist: { tcs: 2, abs: true } }); bike.reset(0, 0, 40);
  const rig = { messages, bus, store, ecu, hmi, bike, now: 0 };
  rig.run = seconds => { for (let i = 0; i < seconds * 120; i++) { bike.step(1 / 120, {}, true); ecu.step(1 / 120, bike); rig.now += 1000 / 120; bus.advance(rig.now, ecu.source); hmi.update(rig.now, 1 / 120); } };
  return rig;
}

test('circuit is a closed, non-intersecting loop with a racing line inside the track limits', () => {
  assert.ok(track.length > 3000 && track.length < 4000);
  assert.ok(track.corners.length >= 7);
  for (const d of track.lineD) assert.ok(Math.abs(d) <= track.halfWidth - 1);
  for (const v of track.lineV) assert.ok(v > 20 && v <= 83);
  const located = track.locate(track.frame(1234, 2.5).x, track.frame(1234, 2.5).z);
  assert.ok(Math.abs(located.s - 1234) < 2 && Math.abs(located.d - 2.5) < .2);
});

test('autopilot bike laps the circuit without leaving the asphalt or crashing', () => {
  const bike = new Bike(track, { skill: 1, assist: { tcs: 2, abs: true } }); bike.reset(0, 0, 30);
  let time = 0, laps = [], lapStart = 0;
  while (laps.length < 2 && time < 240) {
    const before = bike.s; bike.step(1 / 120, {}, true); time += 1 / 120;
    assert.equal(bike.state, 'riding'); assert.ok(Math.abs(bike.d) <= track.halfWidth + 1.1, `off track at s=${bike.s.toFixed(0)}`);
    if (bike.s < before) { laps.push(time - lapStart); lapStart = time; }
  }
  assert.equal(laps.length, 2);
  assert.ok(laps[1] > 70 && laps[1] < 90, `flying lap ${laps[1]}`);
});

test('race runs start lights, timing and classification to the chequered flag', () => {
  const race = new Race(track, { laps: 1 }); race.beginCountdown();
  let lights = 0, went = false, steps = 0;
  while (race.state !== 'finished' && steps++ < 120 * 200) { race.step(1 / 120, {}, true); for (const e of race.events) { if (e.type === 'light') lights = e.count; if (e.type === 'go') went = true; } }
  assert.equal(lights, 5); assert.ok(went); assert.equal(race.state, 'finished');
  assert.equal(race.entries.length, 8); assert.deepEqual(race.order.map(e => e.position), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.ok(race.player.finished && race.player.laps.length === 1);
});

test('DBC round-trips signed and scaled signals and protects frames with counter + CRC', () => {
  const messages = dbc(), imu = [...messages.values()].find(m => m.name === 'IMU_1');
  assert.equal(messages.size, 10); assert.equal(imu.cycle, 20);
  const frame = encodeFrame(imu, { LeanAngle: -47.35, PitchAngle: 3.2, LongAccel: -9.4, LatAccel: 11.05, YawRate: -20.4 }, 9);
  const decoded = decodeFrame(imu, frame.data);
  assert.ok(Math.abs(decoded.LeanAngle + 47.35) < .026 && Math.abs(decoded.LongAccel + 9.4) < .026 && Math.abs(decoded.YawRate + 20.4) < .11);
  assert.equal(frame.data[7], crc8(frame.data, 7, imu.id));
  const store = new SignalStore(messages); assert.equal(store.receive(frame, 0), true);
  const bad = { ...frame, data: Uint8Array.from(frame.data) }; bad.data[0] ^= 1;
  assert.equal(store.receive(bad, 10), false); assert.equal(store.stats.crcErrors, 1);
});

test('bus transmits at DBC cycle times and the cluster shows decoded values after the boot sequence', () => {
  const r = rig(); r.run(.5); assert.equal(r.hmi.view.power, 'boot'); r.run(3.5);
  const v = r.hmi.view; assert.equal(v.power, 'run');
  assert.ok(Math.abs(v.speed.pointer - r.bike.speed * 3.6) < 6); assert.equal(v.gear, r.bike.gear); assert.equal(v.alerts.length, 0);
  assert.ok(r.bus.rate > 250 && r.bus.rate < 360); assert.equal(r.store.stats.crcErrors, 0);
});

test('node timeout invalidates only its signals, raises a prioritised alert and stores a DTC', () => {
  const r = rig(); r.run(4); r.ecu.setFault('abs_off', true); r.run(1);
  let v = r.hmi.view; assert.equal(v.speed.valid, false); assert.equal(v.rpm.valid, true);
  assert.equal(v.popup.code, 'U0121'); assert.ok(v.telltales.abs);
  r.ecu.setFault('overheat', true); r.run(30); v = r.hmi.view;
  assert.deepEqual(v.alerts.map(a => a.code).sort(), ['P0217', 'U0121']);
  assert.ok(r.hmi.acknowledge()); r.ecu.setFault('abs_off', false); r.ecu.setFault('overheat', false); r.run(60);
  assert.equal(r.hmi.view.speed.valid, true); assert.equal(r.hmi.view.alerts.length, 0);
  assert.ok(r.hmi.dtcs.every(d => !d.active) && r.hmi.dtcs.some(d => d.code === 'U0121'));
});

test('corrupted frames are rejected by CRC and reported as invalid data, not as a silent node', () => {
  const r = rig(); r.run(4); r.bus.corrupt.add(0x120); r.run(1);
  assert.ok(r.store.stats.crcErrors > 20); assert.equal(r.hmi.view.popup.code, 'U0418'); assert.equal(r.hmi.view.speed.valid, false);
});

test('ambient light sensor switches the day/night theme with hysteresis', () => {
  const r = rig(); r.run(4); assert.equal(r.hmi.view.night, false);
  r.ecu.ambientLight = 300; r.run(1.5); assert.equal(r.hmi.view.night, true);
  r.ecu.ambientLight = 4000; r.run(1.5); assert.equal(r.hmi.view.night, true);
  r.ecu.ambientLight = 60000; r.run(1.5); assert.equal(r.hmi.view.night, false);
});

test('reduced motion keeps blink steady so turn signals and telltales never flash', () => {
  const r = rig(); r.hmi.reducedMotion = true;
  r.ecu.left = true; r.run(4); // complete the boot / check sequence into RUN
  assert.equal(r.hmi.view.power, 'run');
  const blinks = new Set();
  for (let i = 0; i < 120 * 3; i++) {
    r.run(1 / 120);
    blinks.add(r.hmi.view.blink);
    assert.equal(r.hmi.view.telltales.left, true, 'left indicator stays lit, not blinking');
  }
  assert.deepEqual([...blinks], [true]);
  const normal = rig(), normalBlinks = new Set();
  for (let i = 0; i < 120 * 3; i++) { normal.run(1 / 120); normalBlinks.add(normal.hmi.view.blink); }
  assert.ok(normalBlinks.has(true) && normalBlinks.has(false), 'default mode still blinks');
});
