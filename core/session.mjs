// The shared simulation used by the game, bench and automated acceptance runs.
import { Track, lerp } from './track.mjs';
import { Race } from './race.mjs';
import { ASSISTS } from './bike.mjs';
import { CanBus, SignalStore } from './can.mjs';
import { Electronics, FAULTS } from './ecu.mjs';
import { ClusterModel } from '../hmi/model.mjs';

export const STEP = 1 / 120;
export const ENVIRONMENTS = {
  clear: { label: '晴天', grip: 1, light: 60000, temp: 24 },
  dusk: { label: '黄昏', grip: 1, light: 7500, temp: 19 },
  rain: { label: '雨夜', grip: .78, light: 700, temp: 15 },
};
export const BENCH = { speed: 120, rpm: 8500, throttle: 35, lean: 22, gear: 3, coolant: 85, fuel: 65, front: 2.4, rear: 2.7, light: 60000 };

export class Session {
  constructor(messages, options = {}) {
    this.messages = messages; this.track = options.track ?? new Track();
    this.environment = options.environment ?? 'clear'; this.assist = options.assist ?? 'rookie';
    this.reducedMotion = !!options.reducedMotion;
    this.settings = { lang: 'zh', units: 'metric', theme: 'auto', page: 0 };
    this.start(options.mode ?? 'demo');
  }
  start(mode = 'demo') {
    this.mode = mode; this.auto = true; this.paused = false; this.now = 0;
    this.bus = new CanBus(this.messages); this.store = new SignalStore(this.messages); this.ecu = new Electronics();
    this.hmi = new ClusterModel(this.store, { map: this.track.minimap(), settings: this.settings, reducedMotion: this.reducedMotion });
    this.settings = this.hmi.settings;
    this.bus.subscribe((frame, now) => this.store.receive(frame, now));
    this.race = new Race(this.track, { mode: mode === 'race' ? 'race' : 'practice', laps: 2, opponents: mode === 'practice' || mode === 'bench' ? 0 : 7, assist: this.assist, grip: ENVIRONMENTS[this.environment].grip });
    if (mode === 'race') this.race.beginCountdown();
    if (mode === 'bench') this.ecu.override = { ...BENCH, light: ENVIRONMENTS[this.environment].light };
    this.previous = this.race.entries.map(e => this.pose(e.bike));
    this.current = this.race.entries.map(e => this.pose(e.bike));
    this.events = []; this.outside = 0; this.crashes = 0; this.tcsSteps = 0;
  }
  pose(bike) { return { s: bike.s, d: bike.d, psi: bike.psi, lean: bike.lean, pitch: bike.pitch, speed: bike.speed }; }
  takeOver() { if (this.mode !== 'bench') { this.auto = false; if (this.mode === 'demo') this.mode = 'practice'; } }
  setEnvironment(name) {
    if (!ENVIRONMENTS[name]) return;
    this.environment = name;
    for (const e of this.race.entries) e.bike.grip = ENVIRONMENTS[name].grip;
    if (this.ecu.override) this.ecu.override.light = ENVIRONMENTS[name].light;
  }
  setFault(name, on) {
    if (!FAULTS[name]) return;
    this.ecu.setFault(name, on);
    if (name === 'crc_abs') on ? this.bus.corrupt.add(0x120) : this.bus.corrupt.delete(0x120);
  }
  step(input = {}) {
    this.events = [];
    if (this.paused) return;
    const dt = STEP, race = this.race, bike = race.player.bike, env = ENVIRONMENTS[this.environment];
    this.previous = this.current;
    this.ecu.applyTo(bike, ASSISTS[this.assist]);
    if (this.mode !== 'bench') race.step(dt, input, this.auto);
    this.events = this.mode === 'bench' ? [] : [...race.events];
    const corner = this.track.nextCorner(bike.s);
    this.ecu.nav = { dist: corner?.distance ?? 0, dir: corner ? (corner.corner.dir > 0 ? 2 : 1) : 0, num: corner?.corner.number ?? 0, pos: bike.s / this.track.length, speed: this.track.at(this.track.lineV, bike.s) * Math.sqrt(env.grip) * 3.6 };
    const p = race.player;
    this.ecu.lap = { lap: Math.max(1, p.lap), laps: race.options.mode === 'race' ? race.laps : 0, position: p.position, entrants: race.entries.length, time: p.lapTime, sector: p.sector,
      flag: race.state === 'finished' ? 3 : race.state === 'racing' ? 1 : 4, last: p.last, best: Number.isFinite(p.best) ? p.best : 0, delta: p.delta,
      sectors: [0, 1, 2].map(i => ({ best: 1, personal: 2, slower: 3 })[(p.sectors[i] ?? p.lastSectors[i])?.status] ?? 0) };
    this.ecu.step(dt, bike, { light: lerp(env.light, 400, this.track.tunnelWeight(bike.s, 8)), temp: env.temp });
    // Preserve cyclic deadlines to < 1 ms, including the final fraction of each 120 Hz tick.
    const end = this.now + dt * 1000;
    for (let time = this.now + 1; time < end; time += 1) this.bus.advance(time, this.ecu.source);
    this.bus.advance(end, this.ecu.source); this.now = end;
    this.hmi.update(this.now, dt);
    this.current = race.entries.map(e => this.pose(e.bike));
    if (Math.abs(bike.d) > this.track.halfWidth + 1.1) this.outside++;
    if (bike.tcsActive) this.tcsSteps++;
    this.crashes = p.crashes;
  }
  poses(alpha = 1) {
    return this.current.map((b, i) => {
      const a = this.previous[i];
      return { s: this.track.wrap(a.s + this.track.delta(a.s, b.s) * alpha), d: lerp(a.d, b.d, alpha), psi: lerp(a.psi, b.psi, alpha), lean: lerp(a.lean, b.lean, alpha), pitch: lerp(a.pitch, b.pitch, alpha), speed: lerp(a.speed, b.speed, alpha) };
    });
  }
}
