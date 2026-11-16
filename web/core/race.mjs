// Race session: grid, start lights, AI racecraft, lap/sector timing and classification.
import { Bike, ASSISTS } from './bike.mjs';
import { clamp, lerp } from './track.mjs';

export const RIDERS = [
  { name: 'K. Aoyama', code: 'AOY', number: 21, skill: 1.0, livery: 0 },
  { name: 'M. Rossetti', code: 'ROS', number: 46, skill: .99, livery: 1 },
  { name: 'J. Müller', code: 'MUL', number: 7, skill: .98, livery: 2 },
  { name: 'L. Chen', code: 'CHE', number: 88, skill: .97, livery: 3 },
  { name: 'A. Duval', code: 'DUV', number: 5, skill: .96, livery: 4 },
  { name: 'S. Okafor', code: 'OKA', number: 33, skill: .95, livery: 5 },
  { name: 'T. Lindqvist', code: 'LIN', number: 12, skill: .94, livery: 6 },
];
export const PLAYER = { name: 'YOU', code: 'YOU', number: 1, skill: .985, livery: 7 };
const LIGHT_INTERVAL = .9;

export class Race {
  constructor(track, options = {}) {
    this.track = track;
    this.options = { laps: 3, opponents: 7, mode: 'race', assist: 'rookie', grip: 1, ...options };
    this.entries = [];
    const ai = RIDERS.slice(0, this.options.opponents);
    [...ai, PLAYER].forEach((rider, index) => {
      const player = rider === PLAYER, bike = new Bike(track, { skill: rider.skill, assist: player ? ASSISTS[this.options.assist] : { tcs: 2, abs: true } });
      this.entries.push({ ...rider, index, player, bike, grid: index });
    });
    this.player = this.entries.at(-1);
    this.reset();
  }
  gridSlot(index) {
    const row = Math.floor(index / 3), column = index % 3;
    return { s: -(9 + row * 9 + column * 2), d: [-3.4, 0, 3.4][column] };
  }
  reset() {
    this.state = this.options.mode === 'race' ? 'grid' : 'racing';
    this.time = 0; this.clock = 0; this.lights = 0; this.lightsOut = false; this.events = []; this.sessionBest = Infinity;
    this.sessionSectors = [Infinity, Infinity, Infinity];
    for (const entry of this.entries) {
      const slot = this.options.mode === 'race' ? this.gridSlot(entry.grid) : { s: -(12 + entry.grid * 26), d: 0 };
      entry.bike.reset(slot.s, slot.d, this.options.mode === 'race' ? 0 : 28); entry.bike.grip = this.options.grip;
      if (this.options.mode !== 'race') entry.bike.gear = 2;
      Object.assign(entry, {
        distance: slot.s, lap: 0, lapStart: 0, lapTime: 0, laps: [], best: Infinity, last: 0, sector: 0, sectorStart: 0,
        sectors: [], bestSectors: [Infinity, Infinity, Infinity], finished: false, finishTime: 0, position: entry.grid + 1,
        reaction: entry.player ? 0 : .18 + (entry.grid * 37 % 10) * .022, gap: 0, delta: 0, crashes: 0, topSpeed: 0, maxLean: 0, refSplits: null, lapSplits: [],
      });
    }
    this.classify();
  }
  get laps() { return this.options.mode === 'race' ? this.options.laps : Infinity; }
  beginCountdown() { if (this.state === 'grid') { this.state = 'countdown'; this.clock = 0; } }
  step(dt, input, autoPlayer = false) {
    this.events.length = 0;
    if (this.state === 'grid') { for (const e of this.entries) e.bike.step(dt, { hold: true }, true); return; }
    if (this.state === 'countdown') {
      this.clock += dt; const lit = Math.min(5, Math.floor(this.clock / LIGHT_INTERVAL));
      if (lit !== this.lights) { this.lights = lit; this.events.push({ type: 'light', count: lit }); }
      if (this.clock >= LIGHT_INTERVAL * 5 + 1.1) { this.state = 'racing'; this.lights = 0; this.lightsOut = true; this.time = 0; this.events.push({ type: 'go' }); }
      else { for (const e of this.entries) e.bike.step(dt, { hold: true }, true); return; }
    }
    this.time += dt;
    this.racecraft(dt);
    for (const entry of this.entries) {
      const bike = entry.bike, before = bike.travelled;
      if (entry.finished) { bike.step(dt, {}, true); bike.skill = Math.max(.45, bike.skill - dt * .12); }
      else if (entry.player && !autoPlayer) bike.step(dt, input, false);
      else if (this.time < entry.reaction) bike.step(dt, { hold: true }, true);
      else bike.step(dt, {}, true);
      entry.distance += bike.travelled - before;
      entry.topSpeed = Math.max(entry.topSpeed, bike.speed); entry.maxLean = Math.max(entry.maxLean, Math.abs(bike.lean));
      for (const event of bike.events) {
        if (event.startsWith('crash')) { entry.crashes++; this.events.push({ type: 'crash', entry, kind: event.slice(6) }); }
        else if (entry.player) this.events.push({ type: event, entry });
      }
      this.timing(entry);
    }
    this.contacts();
    this.classify();
    if (this.state === 'racing' && this.options.mode === 'race' && this.player.finished) { this.state = 'finished'; this.events.push({ type: 'finish', entry: this.player }); }
  }
  timing(entry) {
    const length = this.track.length;
    if (entry.finished || entry.distance < 0) { entry.lapTime = Math.max(0, this.time - entry.lapStart); return; }
    const lap = Math.floor(entry.distance / length), within = entry.distance - lap * length;
    if (entry.lap === 0) { entry.lap = 1; entry.lapStart = entry.player && this.options.mode !== 'race' ? this.time : 0; entry.sectorStart = entry.lapStart; }
    entry.lapTime = this.time - entry.lapStart;
    const sectorIndex = lap + 1 > entry.lap ? 3 : this.track.sectors.findIndex(end => within < end);
    if (sectorIndex > entry.sector) {
      const time = this.time - entry.sectorStart, index = entry.sector;
      const status = time < this.sessionSectors[index] ? 'best' : time < entry.bestSectors[index] ? 'personal' : 'slower';
      const previous = entry.bestSectors[index];
      this.sessionSectors[index] = Math.min(this.sessionSectors[index], time); entry.bestSectors[index] = Math.min(previous, time);
      entry.sectors[index] = { time, status }; entry.sectorStart = this.time; entry.sector = sectorIndex; entry.lapSplits[index] = entry.lapTime;
      if (entry.refSplits) entry.delta = entry.lapTime - entry.refSplits[index];
      if (entry.player) this.events.push({ type: 'sector', entry, index, time, status, delta: Number.isFinite(previous) ? time - previous : null });
    }
    if (lap + 1 > entry.lap) {
      const time = entry.lapTime, improved = time < entry.best, record = time < this.sessionBest;
      entry.laps.push(time); entry.last = time; if (improved) { entry.best = time; entry.refSplits = [...entry.lapSplits]; }
      this.sessionBest = Math.min(this.sessionBest, time);
      entry.lap = lap + 1; entry.lapStart = this.time; entry.sector = 0; entry.sectors = []; entry.lapSplits = [];
      if (lap >= this.laps) { entry.finished = true; entry.finishTime = this.time; entry.lap = this.laps; }
      if (entry.player) this.events.push({ type: 'lap', entry, time, improved, record, final: entry.finished });
    }
  }
  // AI picks a passing side around slower traffic and lifts when boxed in.
  racecraft(dt) {
    const length = this.track.length, limit = this.track.halfWidth - 1.3, player = this.player;
    for (const entry of this.entries) {
      const bike = entry.bike; if (entry.player || bike.state !== 'riding') continue;
      let want = 0, pace = entry.skill;
      const gapToPlayer = entry.distance - player.distance;
      if (this.options.mode === 'race') pace *= 1 - clamp((gapToPlayer - 60) / 900, 0, .07) + clamp((-gapToPlayer - 60) / 1200, 0, .025);
      for (const other of this.entries) {
        if (other === entry) continue;
        const ahead = this.track.delta(bike.s, other.bike.s), side = other.bike.d - bike.d;
        if (ahead > -1 && ahead < 6 + bike.speed * .45 && Math.abs(side) < 1.9) {
          const lineHere = this.track.at(this.track.lineD, bike.s), right = other.bike.d + 2.3, left = other.bike.d - 2.3;
          const pick = Math.abs(right) <= limit && (Math.abs(left) > limit || side < 0 || (side === 0 && entry.index % 2)) ? right : left;
          if (Math.abs(pick) <= limit) want = pick - lineHere;
          if (ahead < 9 && Math.abs(side) < 1.1 && bike.speed > other.bike.speed) pace = Math.min(pace, other.bike.speed / Math.max(1, this.track.at(this.track.lineV, bike.s)) );
        }
      }
      bike.offset = lerp(bike.offset, want, 1 - Math.exp(-dt * (want ? 2.2 : .8))); bike.skill = pace;
    }
  }
  contacts() {
    for (let i = 0; i < this.entries.length; i++) for (let j = i + 1; j < this.entries.length; j++) {
      const a = this.entries[i].bike, b = this.entries[j].bike; if (a.state !== 'riding' || b.state !== 'riding') continue;
      const along = this.track.delta(a.s, b.s), side = b.d - a.d;
      if (Math.abs(along) < 1.9 && Math.abs(side) < .75) {
        const push = (.75 - Math.abs(side)) * .5 * (Math.sign(side) || 1); a.d -= push; b.d += push;
        const rear = along > 0 ? a : b; rear.speed *= .985;
        if (this.entries[i].player || this.entries[j].player) this.events.push({ type: 'contact' });
      }
    }
  }
  classify() {
    const order = [...this.entries].sort((a, b) => (a.finished && b.finished ? a.finishTime - b.finishTime : b.finished - a.finished || b.distance - a.distance));
    const leader = order[0];
    order.forEach((entry, index) => { entry.position = index + 1; entry.gap = leader.distance - entry.distance; });
    this.order = order;
  }
}
