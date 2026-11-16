// Vehicle electronics: slow plant models (thermal, fuel, tyres) and the ECUs that publish them.
// Everything the cluster shows originates here and travels over the CAN bus.
import { clamp, lerp } from './track.mjs';
import { torque, REDLINE } from './bike.mjs';

export const MODES = ['ROAD', 'SPORT', 'RAIN'];
export const MODE_TCS = { ROAD: 4, SPORT: 2, RAIN: 7 };
export const FAULTS = {
  bus_off: { group: 'bus', zh: '总线关闭 (Bus-Off)', en: 'Bus-off' },
  ecm_off: { group: 'bus', zh: 'ECM 节点离线', en: 'ECM node silent', sender: 'ECM' },
  abs_off: { group: 'bus', zh: 'ABS 节点离线', en: 'ABS node silent', sender: 'ABS' },
  imu_off: { group: 'bus', zh: 'IMU 节点离线', en: 'IMU node silent', sender: 'IMU' },
  tpms_off: { group: 'bus', zh: 'TPMS 节点离线', en: 'TPMS node silent', sender: 'TPMS' },
  crc_abs: { group: 'bus', zh: 'ABS_1 报文 CRC 错误', en: 'ABS_1 CRC corruption' },
  overheat: { group: 'sensor', zh: '冷却液过热', en: 'Coolant overheat' },
  low_fuel: { group: 'sensor', zh: '燃油不足', en: 'Low fuel' },
  puncture: { group: 'sensor', zh: '后轮慢漏气', en: 'Rear tyre puncture' },
  abs_fault: { group: 'sensor', zh: 'ABS 故障', en: 'ABS fault' },
  tcs_fault: { group: 'sensor', zh: 'TCS 故障', en: 'TCS fault' },
  oil: { group: 'sensor', zh: '机油压力低', en: 'Low oil pressure' },
  battery: { group: 'sensor', zh: '电池电压低', en: 'Low battery voltage' },
};

export class Electronics {
  constructor() { this.faults = new Set(); this.reset(); }
  reset() {
    this.mode = 'SPORT'; this.ignition = 2; this.highBeam = false; this.left = false; this.right = false;
    this.coolant = 74; this.fuel = 13.6; this.capacity = 17; this.odometer = 1286.4; this.frontTemp = 42; this.rearTemp = 44;
    this.frontCold = 2.3; this.rearCold = 2.6; this.leak = 0; this.voltage = 14.1; this.fuelRate = 0; this.ambientLight = 60000; this.ambientTemp = 24;
    this.override = null; this.values = {}; this.nav = { dist: 0, dir: 0, num: 0, pos: 0, speed: 0 }; this.lap = { lap: 0, laps: 0, position: 0, entrants: 0, time: 0, sector: 0, flag: 0, last: 0, best: 0, delta: 0 };
  }
  setFault(name, on) { if (on) this.faults.add(name); else this.faults.delete(name); if (name === 'puncture' && !on) this.leak = 0; }
  has(name) { return this.faults.has(name); }
  // How faults feed back into the ride: no ABS/TCS intervention when the unit is faulted or silent, less rear grip when flat.
  applyTo(bike, baseAssist) {
    const absDown = this.has('abs_fault') || this.has('abs_off') || this.has('bus_off'), tcsDown = absDown || this.has('tcs_fault');
    bike.assist = { ...baseAssist, abs: baseAssist.abs && !absDown, tcs: tcsDown ? 0 : Math.max(baseAssist.tcs, this.mode === 'RAIN' ? 3 : this.mode === 'ROAD' ? 2 : 1) };
    bike.rearGrip = clamp(this.rearPressure() / 2.4, .62, 1);
  }
  rearPressure() { return this.rearCold * (1 + (this.rearTemp - 25) / 600) - this.leak; }
  frontPressure() { return this.frontCold * (1 + (this.frontTemp - 25) / 600); }
  // Advance plant models from the bike state (or bench overrides) and refresh the signal table.
  step(dt, bike, environment = {}) {
    const o = this.override, speed = o ? o.speed / 3.6 : bike.speed, rpm = o ? o.rpm : bike.rpm, throttle = o ? o.throttle / 100 : bike.throttle;
    const lean = o ? o.lean : bike.lean * 180 / Math.PI, gear = o ? o.gear : bike.gear, brake = o ? 0 : bike.brake, running = this.ignition === 2;
    const power = running ? throttle * torque(rpm) * rpm * Math.PI / 30 / 1000 : 0, load = clamp(power / 150, 0, 1);
    this.fuelRate = running ? .9 + power * .3 : 0;
    this.fuel = Math.max(0, this.fuel - this.fuelRate / 3600 * dt);
    const coolantTarget = this.has('overheat') ? 124 : running ? clamp(84 + 24 * load - speed * .14, 76, 108) : this.ambientTemp;
    this.coolant = o?.coolant ?? lerp(this.coolant, coolantTarget, 1 - Math.exp(-dt / (this.has('overheat') ? 5 : 22)));
    const work = o ? 0 : clamp(bike.usage, 0, 1.2);
    this.frontTemp = lerp(this.frontTemp, this.ambientTemp + 20 + 52 * work + brake * 14, 1 - Math.exp(-dt / 28));
    this.rearTemp = lerp(this.rearTemp, this.ambientTemp + 22 + 58 * work + throttle * 12, 1 - Math.exp(-dt / 24));
    if (this.has('puncture')) this.leak = Math.min(1.35, this.leak + dt * .16);
    this.voltage = lerp(this.voltage, this.has('battery') ? 11.2 : running ? 14.1 : 12.6, 1 - Math.exp(-dt * .8));
    this.odometer += speed * dt / 1000;
    this.ambientLight = environment.light ?? this.ambientLight; this.ambientTemp = environment.temp ?? this.ambientTemp;
    const absFault = this.has('abs_fault'), rearSlip = !o && bike.tcsActive ? 1.035 : 1;
    this.values = {
      EngineSpeed: running ? rpm : 0, ThrottlePos: throttle * 100, Gear: gear, EngineRunning: +running, QuickShiftActive: +(!o && bike.shift > 0), EngineLoad: load * 100,
      CoolantTemp: this.has('overheat') ? Math.max(124, this.coolant) : this.coolant, OilPressureLow: +this.has('oil'), MIL: +(this.has('oil') || this.has('overheat')), FuelLevel: this.has('low_fuel') ? 10 : (o?.fuel ?? this.fuel / this.capacity * 100), FuelRate: this.fuelRate, BatteryVoltage: this.voltage,
      FrontWheelSpeed: speed * 3.6, RearWheelSpeed: speed * 3.6 * rearSlip, BrakePressure: brake * 18, BrakeSwitch: +(brake > .05), ABSActive: +(!o && bike.absActive && !absFault), ABSFault: +absFault,
      LeanAngle: lean, PitchAngle: o ? 0 : bike.pitch * 180 / Math.PI, LongAccel: o ? 0 : bike.accel, LatAccel: o ? 0 : bike.lateralAccel, YawRate: o ? 0 : bike.yawRate * 180 / Math.PI,
      TCSActive: +(!o && bike.tcsActive), TCSFault: +(this.has('tcs_fault') || absFault), AWCActive: +(!o && bike.awcActive), TCSLevel: MODE_TCS[this.mode], RideMode: MODES.indexOf(this.mode), GripUsage: o ? 0 : clamp(bike.usage, 0, 1.27) * 100,
      TurnLeft: +this.left, TurnRight: +this.right, HighBeam: +this.highBeam, LowBeam: 1, SideStand: 0, Ignition: this.ignition, AmbientLight: o?.light ?? this.ambientLight, AmbientTemp: this.ambientTemp, Odometer: this.odometer,
      FrontPressure: o?.front ?? this.frontPressure(), RearPressure: (o?.rear ?? this.rearPressure() + this.leak) - this.leak, FrontTyreTemp: this.frontTemp, RearTyreTemp: this.rearTemp, TPMSFault: 0,
      NextTurnDist: this.nav.dist, NextTurnDir: this.nav.dir, NextTurnNum: this.nav.num, TrackPos: this.nav.pos, RecommendedSpeed: this.nav.speed,
      LapNumber: this.lap.lap, LapsTotal: this.lap.laps, Position: this.lap.position, Entrants: this.lap.entrants, CurrentLapTime: this.lap.time, Sector: this.lap.sector, RaceFlag: this.lap.flag,
      LastLapTime: this.lap.last, BestLapTime: this.lap.best, LapDelta: this.lap.delta,
      Sector1Status: this.lap.sectors?.[0] ?? 0, Sector2Status: this.lap.sectors?.[1] ?? 0, Sector3Status: this.lap.sectors?.[2] ?? 0,
    };
  }
  // Bus source: a node that is switched off, faulted silent or bus-off transmits nothing.
  source = message => {
    if (this.has('bus_off') || (this.ignition === 0 && message.sender !== 'BCM')) return null;
    for (const name of this.faults) if (FAULTS[name].sender === message.sender) return null;
    return this.values;
  };
}
