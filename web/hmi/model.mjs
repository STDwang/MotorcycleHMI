// Cluster view-model. Reads decoded signals from the SignalStore and produces everything the renderer
// needs: power-state machine, display filtering, telltales, prioritised alerts, DTC memory, trip computer.
// No rendering and no DOM here, so it runs under node tests (and maps 1:1 onto a C++ backend for QML).

export const PAGES = ['lean', 'tyres', 'nav', 'trip', 'dtc'];
export const MODE_NAMES = ['ROAD', 'SPORT', 'RAIN'];
const RED = 1, AMBER = 2;

// priority: lower number wins the popup. on/off are debounce times in ms.
export const ALERTS = [
  { code: 'U0001', level: RED, telltale: 'master', on: 0, off: 300, when: v => v.busDead },
  { code: 'U0100', level: RED, telltale: 'mil', on: 0, off: 300, when: v => !v.busDead && v.lost.ENGINE_1 },
  { code: 'U0418', level: RED, telltale: 'abs', on: 0, off: 300, when: v => !v.busDead && v.lost.ABS_1 && v.crcFail.ABS_1 },
  { code: 'U0121', level: RED, telltale: 'abs', on: 0, off: 300, when: v => !v.busDead && v.lost.ABS_1 && !v.crcFail.ABS_1 },
  { code: 'P0520', level: RED, telltale: 'oil', on: 200, off: 500, when: v => v.raw.OilPressureLow === 1 },
  { code: 'P0217', level: RED, telltale: 'temp', on: 500, off: 1000, when: v => v.raw.CoolantTemp >= 116 },
  { code: 'C0750', level: RED, telltale: 'tpms', on: 500, off: 1000, when: v => v.raw.RearPressure !== null && v.raw.RearPressure < 1.8 },
  { code: 'U0125', level: AMBER, telltale: 'master', on: 0, off: 300, when: v => !v.busDead && v.lost.IMU_1 },
  { code: 'U0127', level: AMBER, telltale: 'tpms', on: 0, off: 300, when: v => !v.busDead && v.lost.TPMS_1 },
  { code: 'U0140', level: AMBER, telltale: 'master', on: 0, off: 300, when: v => !v.busDead && v.lost.BCM_1 },
  { code: 'C0035', level: AMBER, telltale: 'abs', on: 100, off: 500, when: v => v.raw.ABSFault === 1 },
  { code: 'C1210', level: AMBER, telltale: 'tcs', on: 100, off: 500, when: v => v.raw.TCSFault === 1 && v.raw.ABSFault !== 1 },
  { code: 'P0118', level: AMBER, telltale: 'temp', on: 500, off: 1000, when: v => v.raw.CoolantTemp >= 108 && v.raw.CoolantTemp < 116 },
  { code: 'C0755', level: AMBER, telltale: 'tpms', on: 500, off: 1000, when: v => v.raw.RearPressure !== null && v.raw.RearPressure >= 1.8 && v.raw.RearPressure < 2.3 },
  { code: 'C0745', level: AMBER, telltale: 'tpms', on: 500, off: 1000, when: v => v.raw.FrontPressure !== null && v.raw.FrontPressure < 2.0 },
  { code: 'P0460', level: AMBER, telltale: 'fuel', on: 800, off: 1500, when: v => v.raw.FuelLevel !== null && v.raw.FuelLevel < 12 },
  { code: 'P0562', level: AMBER, telltale: 'battery', on: 800, off: 1500, when: v => v.raw.BatteryVoltage !== null && v.raw.BatteryVoltage < 11.8 },
];
const SUPERVISED = ['ENGINE_1', 'ENGINE_2', 'ABS_1', 'IMU_1', 'TCS_1', 'BCM_1', 'TPMS_1', 'NAV_1', 'LAP_1'];
const SIGNALS = ['EngineSpeed', 'ThrottlePos', 'Gear', 'EngineRunning', 'CoolantTemp', 'OilPressureLow', 'MIL', 'FuelLevel', 'FuelRate', 'BatteryVoltage', 'FrontWheelSpeed',
  'RearWheelSpeed', 'BrakePressure', 'ABSActive', 'ABSFault', 'LeanAngle', 'PitchAngle', 'LongAccel', 'LatAccel', 'TCSActive', 'TCSFault', 'AWCActive', 'TCSLevel', 'RideMode', 'GripUsage',
  'TurnLeft', 'TurnRight', 'HighBeam', 'Ignition', 'AmbientLight', 'AmbientTemp', 'Odometer', 'FrontPressure', 'RearPressure', 'FrontTyreTemp', 'RearTyreTemp',
  'NextTurnDist', 'NextTurnDir', 'NextTurnNum', 'TrackPos', 'RecommendedSpeed', 'LapNumber', 'LapsTotal', 'Position', 'Entrants', 'CurrentLapTime', 'Sector', 'RaceFlag', 'LastLapTime', 'BestLapTime', 'LapDelta', 'Sector1Status', 'Sector2Status', 'Sector3Status'];
const damp = (current, target, rate, dt) => current + (target - current) * (1 - Math.exp(-rate * dt));

export class ClusterModel {
  constructor(store, options = {}) {
    this.store = store; this.tank = options.tank ?? 17; this.map = options.map ?? [];
    this.settings = { lang: 'zh', units: 'metric', theme: 'auto', page: 0, ...options.settings };
    this.alertState = new Map(ALERTS.map(a => [a.code, { since: null, clearSince: null, active: false, acked: false, shownAt: 0 }]));
    this.dtcs = []; this.crcSeen = new Map(); this.reset();
  }
  reset() {
    this.power = 'off'; this.powerTime = 0; this.clock = 0; this.night = false; this.themeMix = 0; this.lightTimer = 0;
    this.smooth = { rpm: 0, speed: 0, lean: 0, throttle: 0, brake: 0, grip: 0, coolant: 60, fuel: 50 };
    this.digits = { speed: 0, timer: 0 }; this.trip = { distance: 0, time: 0, fuel: 0, moving: 0 }; this.maxLean = { left: 0, right: 0 };
    this.blink = 0; this.popup = null; this.view = this.compose({}, {}, {}, 0);
  }
  nextPage(step = 1) { this.settings.page = (this.settings.page + step + PAGES.length) % PAGES.length; }
  acknowledge() { if (this.popup) { this.alertState.get(this.popup.code).acked = true; this.popup = null; return true; } return false; }
  clearDTCs() { this.dtcs = this.dtcs.filter(d => d.active); }
  update(now, dt) {
    const store = this.store, raw = {}, lost = {}, crcFail = {};
    for (const name of SIGNALS) raw[name] = store.read(name, now);
    let anyAlive = false;
    for (const name of SUPERVISED) { const alive = store.alive(name, now); lost[name] = !alive; anyAlive ||= alive; }
    for (const message of store.messages.values()) {
      const errors = store.frames.get(message.id).crcErrors, seen = this.crcSeen.get(message.name) ?? { errors: 0, time: -1e9 };
      if (errors !== seen.errors) { seen.errors = errors; seen.time = now; } this.crcSeen.set(message.name, seen); crcFail[message.name] = now - seen.time < 1000;
    }
    this.clock += dt; this.blink = Math.floor(this.clock * 2.6) % 2 === 0;

    // Power-state machine: OFF -> BOOT (logo) -> CHECK (bulb check + needle sweep) -> RUN.
    const ignition = raw.Ignition ?? (anyAlive ? 2 : null); this.powerTime += dt;
    const go = state => { this.power = state; this.powerTime = 0; };
    if (this.power === 'off') { if (ignition >= 1) go('boot'); }
    else if (ignition === 0) go('off');
    else if (this.power === 'boot' && this.powerTime > 1.5) go('check');
    else if (this.power === 'check' && this.powerTime > 1.5) go('run');
    const running = this.power === 'run';
    // During standby (ignition seen, bus later lost) keep running so the fault is visible.
    const lastTraffic = Math.max(...[...store.frames.values()].map(frame => frame.time));
    const busDead = running && now - lastTraffic > 95;

    // Auto theme from the ambient light sensor, with hysteresis and dwell to avoid flicker under bridges.
    const lux = raw.AmbientLight;
    if (this.settings.theme !== 'auto') this.night = this.settings.theme === 'night';
    else if (lux !== null) {
      const want = this.night ? lux < 6000 : lux < 2500;
      if (want !== this.night) { this.lightTimer += dt; if (this.lightTimer > (want ? .25 : .7)) { this.night = want; this.lightTimer = 0; } } else this.lightTimer = 0;
    }
    this.themeMix = damp(this.themeMix, this.night ? 1 : 0, 7, dt);

    // Display filtering: pointers follow at frame rate, digits refresh at 10 Hz.
    const s = this.smooth, sweep = this.power === 'check' ? Math.sin(Math.min(1, this.powerTime / 1.3) * Math.PI) : null;
    s.rpm = damp(s.rpm, sweep !== null ? sweep * 14000 : raw.EngineSpeed ?? 0, 18, dt);
    s.speed = damp(s.speed, sweep !== null ? sweep * 299 : raw.FrontWheelSpeed ?? 0, 12, dt);
    s.lean = damp(s.lean, raw.LeanAngle ?? 0, 14, dt); s.throttle = damp(s.throttle, raw.ThrottlePos ?? 0, 20, dt);
    s.brake = damp(s.brake, Math.min(100, (raw.BrakePressure ?? 0) / 18 * 100), 20, dt); s.grip = damp(s.grip, raw.GripUsage ?? 0, 10, dt);
    s.coolant = damp(s.coolant, raw.CoolantTemp ?? s.coolant, 2, dt); s.fuel = damp(s.fuel, raw.FuelLevel ?? s.fuel, 1.5, dt);
    this.digits.timer += dt; if (this.digits.timer >= .1) { this.digits.timer = 0; this.digits.speed = sweep !== null ? s.speed : raw.FrontWheelSpeed ?? 0; }
    if (running && raw.LeanAngle !== null) { this.maxLean.left = Math.max(this.maxLean.left, -raw.LeanAngle); this.maxLean.right = Math.max(this.maxLean.right, raw.LeanAngle); }

    // Trip computer integrates in the cluster from wheel speed and fuel rate.
    if (running && raw.FrontWheelSpeed !== null) {
      const km = raw.FrontWheelSpeed * dt / 3600; this.trip.distance += km; this.trip.time += dt; if (raw.FrontWheelSpeed > 3) this.trip.moving += dt;
      if (raw.FuelRate !== null) this.trip.fuel += raw.FuelRate * dt / 3600;
    }

    this.evaluateAlerts({ raw, lost, crcFail, busDead }, now, running);
    return this.view = this.compose(raw, lost, { busDead, running }, now);
  }
  evaluateAlerts(values, now, running) {
    const active = [];
    for (const alert of ALERTS) {
      const state = this.alertState.get(alert.code), hit = running && (values.busDead ? alert.code === 'U0001' : !!alert.when(values));
      if (values.busDead && alert.code !== 'U0001') {
        state.active = false; state.since = null; state.clearSince = null;
        const dtc = this.dtcs.find(d => d.code === alert.code); if (dtc) dtc.active = false;
      }
      if (hit) { state.clearSince = null; state.since ??= now; if (!state.active && now - state.since >= alert.on) { state.active = true; state.acked = false; state.shownAt = now; this.recordDTC(alert, now); } }
      else { state.since = null; if (state.active) { state.clearSince ??= now; if (now - state.clearSince >= alert.off) { state.active = false; const dtc = this.dtcs.find(d => d.code === alert.code); if (dtc) dtc.active = false; } } }
      if (state.active) active.push({ ...alert, since: state.shownAt, acked: state.acked });
    }
    active.sort((a, b) => a.level - b.level || b.since - a.since);
    // Popup arbitration: the highest-priority unacknowledged alert owns the banner; amber auto-dismisses.
    for (const alert of active) if (!alert.acked && alert.level === AMBER && now - alert.since > 6000) this.alertState.get(alert.code).acked = alert.acked = true;
    this.popup = active.find(a => !a.acked) ?? null; this.active = active;
  }
  recordDTC(alert, now) {
    const existing = this.dtcs.find(d => d.code === alert.code);
    if (existing) { existing.active = true; existing.count++; existing.time = this.clock; }
    else this.dtcs.unshift({ code: alert.code, level: alert.level, active: true, count: 1, time: this.clock });
  }
  compose(raw, lost, flags, now) {
    const s = this.smooth, lamps = new Set((this.active ?? []).map(a => a.telltale)), check = this.power === 'check', on = name => check || lamps.has(name);
    const worst = this.active?.[0]?.level ?? 0, consumption = this.trip.distance > .05 ? this.trip.fuel / this.trip.distance * 100 : null;
    const fuelLitres = raw.FuelLevel != null ? raw.FuelLevel / 100 * this.tank : null;
    return {
      power: this.power, powerTime: this.powerTime, clock: this.clock, night: this.night, themeMix: this.themeMix, blink: this.blink, settings: this.settings, page: PAGES[this.settings.page],
      mode: MODE_NAMES[raw.RideMode ?? 1] ?? 'SPORT', busDead: !!flags.busDead,
      speed: { value: this.digits.speed, pointer: s.speed, valid: check || raw.FrontWheelSpeed != null },
      rpm: { value: s.rpm, valid: check || raw.EngineSpeed != null }, gear: check ? null : raw.Gear ?? null,
      throttle: s.throttle, brake: s.brake, lean: { value: s.lean, valid: raw.LeanAngle != null, left: this.maxLean.left, right: this.maxLean.right }, grip: s.grip,
      coolant: { value: s.coolant, valid: raw.CoolantTemp != null }, fuel: { value: s.fuel, valid: raw.FuelLevel != null },
      range: consumption && fuelLitres !== null ? fuelLitres / consumption * 100 : null,
      trip: { distance: this.trip.distance, avgSpeed: this.trip.moving > 1 ? this.trip.distance / (this.trip.moving / 3600) : null, consumption, odometer: raw.Odometer ?? null },
      tyres: { front: raw.FrontPressure ?? null, rear: raw.RearPressure ?? null, frontTemp: raw.FrontTyreTemp ?? null, rearTemp: raw.RearTyreTemp ?? null, valid: raw.FrontPressure != null },
      tcs: { active: raw.TCSActive === 1, level: raw.TCSLevel ?? null, fault: raw.TCSFault === 1 }, abs: { active: raw.ABSActive === 1, fault: raw.ABSFault === 1 }, awc: raw.AWCActive === 1,
      shift: raw.EngineSpeed != null ? Math.min(1, Math.max(0, (raw.EngineSpeed - 11000) / 2400)) : 0, ambientTemp: raw.AmbientTemp ?? null, voltage: raw.BatteryVoltage ?? null,
      telltales: {
        left: check || (raw.TurnLeft === 1 && this.blink), right: check || (raw.TurnRight === 1 && this.blink), highBeam: check || raw.HighBeam === 1,
        abs: on('abs') || (raw.ABSActive === 1 && this.blink), tcs: on('tcs') || (raw.TCSActive === 1 && this.blink) || (raw.AWCActive === 1 && this.blink),
        mil: on('mil') || raw.MIL === 1, oil: on('oil'), temp: on('temp'), fuel: on('fuel'), tpms: on('tpms'), battery: on('battery'),
        master: check || worst === RED ? (check || this.blink ? 'red' : 'dim') : worst === AMBER ? 'amber' : null,
      },
      nav: { valid: raw.TrackPos != null, distance: raw.NextTurnDist ?? 0, direction: raw.NextTurnDir ?? 0, number: raw.NextTurnNum ?? 0, position: raw.TrackPos ?? 0, advise: raw.RecommendedSpeed ?? 0, map: this.map },
      lap: { valid: raw.LapNumber != null, number: raw.LapNumber ?? 0, total: raw.LapsTotal ?? 0, position: raw.Position ?? 0, entrants: raw.Entrants ?? 0, time: raw.CurrentLapTime ?? 0, sector: raw.Sector ?? 0, flag: raw.RaceFlag ?? 0, last: raw.LastLapTime ?? 0, best: raw.BestLapTime ?? 0, delta: raw.LapDelta ?? 0,
        sectors: [raw.Sector1Status, raw.Sector2Status, raw.Sector3Status].map(status => ({ status: ['', 'best', 'personal', 'slower'][status] ?? '' })) },
      alerts: this.active ?? [], popup: this.popup, dtcs: this.dtcs, lost,
    };
  }
}
