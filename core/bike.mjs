// Motorcycle dynamics in track coordinates (s along the lap, d lateral, psi heading relative to the track).
// One model drives the player, the AI field and the attract-mode demo.
import { clamp, lerp, smoothstep } from './track.mjs';

export const G = 9.81;
export const GEAR_RATIOS = [2.75, 2.06, 1.67, 1.42, 1.25, 1.13];
export const REDLINE = 14000, IDLE = 1400, SHIFT_UP = 13400;
const RPM_PER_MS = 14000 / (84 * GEAR_RATIOS[5]); // 6th gear tops out at 84 m/s
const MASS = 272, DRAG = .00075, MAX_LEAN = 58 * Math.PI / 180;
const FF = .3;
const SURFACE = {
  asphalt: { grip: 1, drag: 0 }, kerb: { grip: .92, drag: 0 }, runoff: { grip: .9, drag: .3 },
  grass: { grip: .55, drag: 1.8 }, gravel: { grip: .5, drag: 6.5 },
};

export const torque = rpm => { const x = rpm / REDLINE; return 115 * Math.max(.4, 1 - 1.9 * (x - .72) ** 2); };
export const rpmFor = (speed, gear) => speed * RPM_PER_MS * GEAR_RATIOS[gear - 1];
const driveForce = (rpm, gear) => torque(rpm) * RPM_PER_MS * GEAR_RATIOS[gear - 1] * (Math.PI / 30) * .92;

export const ASSISTS = {
  rookie: { steer: 1, brake: true, tcs: 3, abs: true, line: true },
  standard: { steer: .35, brake: true, tcs: 2, abs: true, line: true },
  pro: { steer: 0, brake: false, tcs: 1, abs: true, line: false },
};

export class Bike {
  constructor(track, options = {}) {
    this.track = track; this.skill = options.skill ?? 1; this.grip = 1;
    this.assist = { ...ASSISTS.pro, ...options.assist };
    this.reset(options.s ?? 0, options.d ?? 0);
  }
  reset(s = 0, d = 0, speed = 0) {
    this.s = this.track.wrap(s); this.d = d; this.psi = 0; this.speed = speed; this.lean = 0; this.pitch = 0;
    this.gear = 1; this.rpm = IDLE; this.throttle = 0; this.brake = 0; this.shift = 0; this.travelled = 0;
    this.accel = 0; this.lateralAccel = 0; this.yawRate = 0; this.slip = 0; this.usage = 0;
    this.tcsActive = false; this.absActive = false; this.awcActive = false; this.offset = 0;
    this.state = 'riding'; this.crashTimer = 0; this.surface = 'asphalt'; this.rearGrip = 1;
    this.wobble = 0; this.events = [];
  }
  // Line-following controller: returns { lean, throttle, brake } to hold the racing line plus `offset`.
  autopilot(pace = this.skill, hold = false) {
    const t = this.track, v = this.speed, look = clamp(v * .45, 7, 34);
    const limit = t.halfWidth - .9, target = clamp(t.at(t.lineD, this.s + look) + this.offset, -limit, limit);
    const reach = look * .1, error = clamp(target - this.d, -reach, reach) - look * Math.sin(this.psi);
    const curvature = t.at(t.k, this.s + look * FF) + 2 * error / (look * look);
    const lean = Math.atan(Math.max(v, 4) ** 2 * curvature / G);
    // Off the ideal line the corner is tighter than the profile assumes, so carry less speed.
    const margin = 1 - Math.min(.12, Math.abs(this.offset) * .03) - Math.min(.1, Math.abs(this.d - t.at(t.lineD, this.s)) * .02);
    const want = hold ? 0 : Math.min(t.at(t.lineV, this.s + v * .08), t.at(t.lineV, this.s + v * .3) + 2) * pace * margin * Math.sqrt(this.grip);
    const gap = want - v;
    return { lean, throttle: clamp(gap * .9 + .15, 0, 1), brake: clamp(-gap * .45 - .05, 0, 1), want };
  }
  step(dt, input = {}, auto = false) {
    this.events.length = 0;
    if (this.state === 'crashed') return this.slide(dt);
    const t = this.track, a = this.assist, surface = SURFACE[this.surface = t.surface(this.s, this.d)];
    const mu = 1.28 * this.grip * surface.grip, v = this.speed;
    const pilot = auto || a.steer > 0 || a.brake ? this.autopilot(auto ? this.skill : .97, input.hold) : null;
    let throttle = clamp(input.throttle ?? 0, 0, 1), brake = clamp(input.brake ?? 0, 0, 1);
    const maxLean = Math.min(MAX_LEAN, Math.atan(mu * 1.02)) * smoothstep(1, 16, v);
    let leanTarget = clamp(input.steer ?? 0, -1, 1) * maxLean;
    if (auto) { throttle = pilot.throttle; brake = pilot.brake; leanTarget = pilot.lean; }
    else {
      if (a.steer >= 1) { this.offset = lerp(this.offset, (input.steer ?? 0) * 3.2, 1 - Math.exp(-dt * 3)); leanTarget = pilot.lean; }
      else if (a.steer > 0) leanTarget = lerp(leanTarget, pilot.lean, a.steer * (1 - Math.abs(input.steer ?? 0) * .6));
      if (a.brake && v > pilot.want + 1.5) { brake = Math.max(brake, pilot.brake); throttle = Math.min(throttle, pilot.throttle); }
    }
    leanTarget = clamp(leanTarget, -maxLean, maxLean);
    this.lean += clamp((leanTarget - this.lean) * 9, -2.4, 2.4) * dt;
    this.throttle = lerp(this.throttle, throttle, 1 - Math.exp(-dt * 14)); this.brake = lerp(this.brake, brake, 1 - Math.exp(-dt * 18));

    // Gearbox: automatic with a quickshifter cut.
    this.shift = Math.max(0, this.shift - dt);
    const wheelRpm = rpmFor(v, this.gear);
    if (this.shift <= 0) {
      if (wheelRpm > SHIFT_UP && this.gear < 6) { this.gear++; this.shift = .09; this.events.push('upshift'); }
      else if (this.gear > 1 && rpmFor(v, this.gear - 1) < (this.throttle > .5 ? 9800 : 8600)) { this.gear--; this.shift = .07; this.events.push('downshift'); }
    }
    const launch = this.gear === 1 ? lerp(IDLE, 7200, this.throttle) : IDLE;
    const rpmTarget = clamp(Math.max(rpmFor(v, this.gear), launch), IDLE, REDLINE + 300);
    this.rpm = lerp(this.rpm, rpmTarget, 1 - Math.exp(-dt * 22));

    // Longitudinal demand, then friction-circle arbitration (TCS / ABS / wheelie control).
    const lateral = v * v * Math.abs(Math.tan(this.lean)) * G / Math.max(v * v, 36);
    const room = Math.sqrt(Math.max(.02, 1 - Math.min(1, lateral / (mu * G)) ** 2)) * mu * G;
    let drive = this.shift > 0 ? 0 : this.throttle * driveForce(this.rpm, this.gear) / MASS;
    if (this.rpm > REDLINE) drive = 0;
    let braking = this.brake * 11.2;
    this.awcActive = drive > 9.4 && this.gear <= 3; if (this.awcActive) drive = 9.4;
    const rearRoom = room * this.rearGrip * (a.tcs ? 1 - .04 * a.tcs : 1);
    this.tcsActive = false; this.absActive = false; let over = 0;
    if (drive > rearRoom) { if (a.tcs) { drive = rearRoom; this.tcsActive = this.throttle > .2; } else over = drive / rearRoom - 1; }
    if (braking > room) { if (a.abs) { braking = room; this.absActive = this.brake > .2 && v > 3; } else over = Math.max(over, braking / room - 1); }
    this.slip = clamp(this.slip + (over > .12 ? over * 2.2 : -1.6) * dt, 0, 1.2);
    this.usage = clamp(Math.hypot(lateral, Math.max(drive, braking)) / (mu * G), 0, 1.5);
    const slope = t.at(t.slope, this.s);
    const resist = DRAG * v * v + .12 + surface.drag + (this.throttle < .05 ? .7 * this.gear ** -.5 : 0);
    const acceleration = drive - braking - resist - G * slope;
    this.speed = Math.max(0, v + acceleration * dt); this.accel = lerp(this.accel, (this.speed - v) / dt, 1 - Math.exp(-dt * 12));
    this.pitch = lerp(this.pitch, clamp(this.accel * .006, -.07, .09) + (this.awcActive ? .05 : 0), 1 - Math.exp(-dt * 8));

    // Lateral: lean angle sets path curvature; slip widens the line.
    this.wobble = lerp(this.wobble, this.slip > .2 ? Math.sin(this.travelled * .9) * this.slip * .05 : 0, 1 - Math.exp(-dt * 10));
    const vv = Math.max(this.speed, 5), bikeK = G * Math.tan(this.lean) / (vv * vv) * (1 - .45 * Math.min(1, this.slip)) + this.wobble * .02;
    const trackK = t.at(t.k, this.s), along = this.speed * Math.cos(this.psi) / Math.max(.35, 1 - this.d * trackK);
    this.yawRate = this.speed * bikeK; this.lateralAccel = this.speed * this.yawRate;
    this.psi = clamp(this.psi + (this.yawRate - along * trackK) * dt, -1.1, 1.1);
    this.s = t.wrap(this.s + along * dt); this.d += this.speed * Math.sin(this.psi) * dt; this.travelled += along * dt;
    if (this.speed < 1.5) this.psi *= Math.exp(-dt * 3);

    const wall = t.barrier(this.s) - .45;
    if (Math.abs(this.d) > wall) {
      const side = Math.sign(this.d), into = this.speed * Math.sin(this.psi) * side;
      this.d = side * wall;
      if (into > 6 || this.speed > 30) this.crash('barrier');
      else { this.speed *= .72; this.psi = -side * .08; this.lean *= .3; this.events.push('scrape'); }
    }
    if (this.slip >= 1) this.crash(this.absActive || this.brake > .3 ? 'lowside' : 'highside');
    return this;
  }
  crash(kind) {
    if (this.state === 'crashed') return;
    this.state = 'crashed'; this.crashTimer = 2.8; this.crashSide = Math.sign(this.lean) || 1; this.events.push('crash:' + kind);
    this.throttle = 0; this.brake = 0; this.tcsActive = this.absActive = this.awcActive = false;
  }
  slide(dt) {
    const t = this.track, trackK = t.at(t.k, this.s), v = this.speed;
    this.speed = Math.max(0, v - (this.surface === 'gravel' ? 16 : 9) * dt); this.accel = (this.speed - v) / dt;
    this.lean = lerp(this.lean, this.crashSide * 1.45, 1 - Math.exp(-dt * 9)); this.rpm = lerp(this.rpm, IDLE, 1 - Math.exp(-dt * 4));
    const along = this.speed * Math.cos(this.psi) / Math.max(.35, 1 - this.d * trackK);
    this.psi = clamp(this.psi - along * trackK * dt, -1.2, 1.2);
    this.s = t.wrap(this.s + along * dt); this.d += this.speed * Math.sin(this.psi) * dt; this.travelled += along * dt;
    const wall = t.barrier(this.s) - .45; if (Math.abs(this.d) > wall) { this.d = Math.sign(this.d) * wall; this.speed *= .5; this.psi = 0; }
    this.surface = t.surface(this.s, this.d); this.crashTimer -= dt;
    if (this.crashTimer <= 0) {
      // Marshals put the bike back on the racing surface; lap distance is preserved.
      const travelled = this.travelled, limit = t.halfWidth - 2;
      this.reset(this.s, clamp(this.d, -limit, limit), 14); this.travelled = travelled; this.gear = 1; this.events.push('respawn');
    }
    return this;
  }
  // World pose for rendering.
  pose(out = {}) {
    const f = this.track.frame(this.s, this.d, out);
    out.heading = Math.atan2(f.tz, f.tx) + this.psi; out.lean = this.lean; out.pitch = this.pitch - Math.atan(f.slope);
    return out;
  }
}
