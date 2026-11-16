import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseDBC, encodeFrame, decodeFrame, SignalStore, AlertManager, VehicleSimulator } from '../web/model.mjs';
const dbc = readFileSync(new URL('../web/vehicle.dbc', import.meta.url), 'utf8');
const messages = parseDBC(dbc);
function populated(values = {}, now = 0) {
  const store = new SignalStore(messages);
  const inputs = { ...new VehicleSimulator().values(), ...values };
  for (const m of messages.values()) store.receive(encodeFrame(m, inputs), now);
  return store;
}
test('known CAN vector decodes little endian, scale, offset and packed control bits', () => {
  const power = decodeFrame(messages.get(256), Uint8Array.from([0x39, 0x30, 0x40, 0x1f, 4, 0x7a, 156, 0]));
  assert.equal(power.Speed.value, 123.45); assert.equal(power.RPM.value, 8000);
  assert.equal(power.Temperature.value, 82); assert.equal(power.Fuel.value, 78);
  const control = decodeFrame(messages.get(258), Uint8Array.from([2, 0b1101, 0, 0, 0, 0, 0, 0]));
  assert.equal(control.Mode.value, 2); assert.equal(control.LeftIndicator.value, 1);
  assert.equal(control.RightIndicator.value, 0); assert.equal(control.HighBeam.value, 1); assert.equal(control.ABSFault.value, 1);
});
test('encode produces expected wire bytes rather than passing values straight to UI', () => {
  const frame = encodeFrame(messages.get(256), { Speed: 123.45, RPM: 8000, Gear: 4, Temperature: 82, Fuel: 78 });
  assert.deepEqual([...frame.data], [0x39, 0x30, 0x40, 0x1f, 4, 0x7a, 156, 0]);
});
test('reject unsupported DBC formats and overlapping signals', () => {
  assert.throws(() => parseDBC(dbc.replace('@1+', '@0+')));
  assert.throws(() => parseDBC(dbc.replace('16|16', '8|16')));
  assert.throws(() => parseDBC(dbc.replace('BO_ 256', 'BO_ 4096')));
});
test('range-invalid and missing values never become valid readings; malformed frames rejected', () => {
  const store = new SignalStore(messages);
  assert.equal(store.read('Speed', 0), null);
  assert.equal(store.receive({ id: 256, data: Uint8Array.from([255, 255, 0, 0, 0, 122, 156, 0]) }, 0), true);
  assert.equal(store.quality('Speed', 0), 'invalid'); assert.equal(store.read('Speed', 0), null);
  assert.equal(store.receive({ id: 256, data: new Uint8Array(2) }, 0), false);
  assert.equal(store.receive({ id: 999, data: new Uint8Array(8) }, 0), false);
  assert.equal(store.rejected, 2);
});
test('timeout boundary, partial frame loss, and recovery', () => {
  const store = populated(); assert.equal(store.read('Speed', 600), 0); assert.equal(store.read('Speed', 601), null);
  store.receive(encodeFrame(messages.get(256), new VehicleSimulator().values()), 650);
  assert.equal(store.quality('Speed', 650), 'valid'); assert.equal(store.quality('FrontPressure', 650), 'stale');
  assert.equal(new AlertManager().update(store, 650)[0].key, 'communication');
});
test('alert priority, acknowledgement, hysteresis, recovery and recurrence', () => {
  const manager = new AlertManager();
  let list = manager.update(populated({ Temperature: 118, FrontPressure: 1.65, Fuel: 8 }), 0);
  assert.deepEqual(list.map(a => a.key), ['temperature', 'pressure', 'fuel']);
  manager.acknowledge(); assert.equal(manager.list().length, 3); assert.equal(manager.list()[0].acknowledged, true);
  list = manager.update(populated({ Temperature: 107, FrontPressure: 2, Fuel: 14 }), 0); assert.equal(list.length, 3);
  assert.equal(manager.update(populated({ Temperature: 104, FrontPressure: 2.11, Fuel: 16 }), 0).length, 0);
  assert.equal(manager.update(populated({ FrontPressure: 1.65 }), 0)[0].acknowledged, false);
});
test('communication failure outranks lower priority alerts and stale numbers disappear', () => {
  const store = populated({ FrontPressure: 1.65 }); const manager = new AlertManager();
  manager.update(store, 0); const list = manager.update(store, 601);
  assert.equal(list[0].key, 'communication'); assert.equal(store.read('FrontPressure', 601), null);
});
test('simulator mode interlock, braking and signal values stay encodable across all scenarios', () => {
  const vehicle = new VehicleSimulator(); vehicle.auto = false; vehicle.throttle = 1;
  for (let i = 0; i < 100; i++) vehicle.step(.05);
  assert.ok(vehicle.speed > 5); assert.equal(vehicle.setMode(1), false);
  vehicle.throttle = 0; vehicle.brake = 1;
  for (let i = 0; i < 100; i++) vehicle.step(.05);
  assert.equal(vehicle.speed, 0); assert.equal(vehicle.setMode(2), true); assert.equal(vehicle.setMode(9), false);
  for (const scenario of ['normal', 'tire', 'overheat', 'abs', 'fuel', 'offline']) {
    vehicle.scenario = scenario;
    for (const message of messages.values()) assert.doesNotThrow(() => encodeFrame(message, vehicle.values()));
  }
});
