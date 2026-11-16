// Circuit geometry, racing line and speed profile. Pure math: no rendering dependencies.
const TAU = Math.PI * 2;
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// Control points (x, z) in metres, clockwise seen from above. Start line is on the first straight.
export const CIRCUIT = {
  name: '云岭国际赛道', en: 'YUNLING INTERNATIONAL CIRCUIT',
  cornerNames: ['晨曦弯', '双顶弯', '回音弯', '湖畔发卡', '松林弯', '云岭 S 弯', '看台弯'],
  halfWidth: 6.5,
  points: [
    [-360, -270], [-180, -270], [0, -270], [180, -270], [330, -270],
    [412, -246], [452, -178], [452, -100],
    [424, -36], [356, -2], [286, 2],
    [226, 34], [200, 96], [222, 160],
    [282, 198], [350, 232], [388, 290],
    [376, 356], [316, 392],
    [200, 398], [50, 384], [-100, 356],
    [-214, 306], [-272, 232], [-272, 150],
    [-226, 88], [-150, 62], [-84, 22],
    [-70, -44], [-116, -100], [-196, -120],
    [-290, -112], [-370, -104], [-446, -128],
    [-486, -188], [-462, -246],
  ],
  tunnel: [0.585, 0.635],
  runoff: 10,
  elevation: s => 14 + 8.5 * Math.sin(TAU * s + 0.9) + 4.2 * Math.sin(2 * TAU * s + 2.4) + 1.6 * Math.sin(3 * TAU * s + 0.4),
};

function catmull(p0, p1, p2, p3, t) {
  // Centripetal Catmull-Rom (Barry-Goldman), avoids loops and overshoot.
  const d = (a, b) => Math.max(1e-6, Math.hypot(b[0] - a[0], b[1] - a[1]) ** 0.5);
  const t0 = 0, t1 = t0 + d(p0, p1), t2 = t1 + d(p1, p2), t3 = t2 + d(p2, p3), u = lerp(t1, t2, t);
  const mix = (a, b, ta, tb) => [a[0] + (b[0] - a[0]) * (u - ta) / (tb - ta), a[1] + (b[1] - a[1]) * (u - ta) / (tb - ta)];
  const a1 = mix(p0, p1, t0, t1), a2 = mix(p1, p2, t1, t2), a3 = mix(p2, p3, t2, t3);
  const b1 = mix(a1, a2, t0, t2), b2 = mix(a2, a3, t1, t3);
  return mix(b1, b2, t1, t2);
}

function curvature3(ax, az, bx, bz, cx, cz) {
  const cross = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
  const l = Math.hypot(bx - ax, bz - az) * Math.hypot(cx - bx, cz - bz) * Math.hypot(cx - ax, cz - az);
  return l < 1e-9 ? 0 : 2 * cross / l;
}

export class Track {
  constructor(def = CIRCUIT, spacing = 2) {
    this.def = def; this.halfWidth = def.halfWidth;
    const pts = def.points, n = pts.length, dense = [];
    for (let i = 0; i < n; i++) for (let j = 0; j < 40; j++) dense.push(catmull(pts[(i + n - 1) % n], pts[i], pts[(i + 1) % n], pts[(i + 2) % n], j / 40));
    const cum = [0];
    for (let i = 0; i < dense.length; i++) { const a = dense[i], b = dense[(i + 1) % dense.length]; cum.push(cum[i] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
    const total = cum[dense.length];
    this.n = Math.round(total / spacing / 32) * 32; this.ds = total / this.n; this.length = total;
    const N = this.n;
    this.x = new Float32Array(N); this.z = new Float32Array(N); this.y = new Float32Array(N);
    this.tx = new Float32Array(N); this.tz = new Float32Array(N); this.slope = new Float32Array(N);
    this.k = new Float32Array(N); this.lineD = new Float32Array(N); this.lineK = new Float32Array(N); this.lineV = new Float32Array(N);
    for (let i = 0, j = 0; i < N; i++) {
      const s = i * this.ds; while (cum[j + 1] < s) j++;
      const t = (s - cum[j]) / (cum[j + 1] - cum[j]), a = dense[j], b = dense[(j + 1) % dense.length];
      this.x[i] = lerp(a[0], b[0], t); this.z[i] = lerp(a[1], b[1], t); this.y[i] = def.elevation(i / N);
    }
    for (let pass = 0; pass < 3; pass++) this.smooth(this.x, 3), this.smooth(this.z, 3);
    for (let i = 0; i < N; i++) {
      const p = (i + N - 1) % N, q = (i + 1) % N, dx = this.x[q] - this.x[p], dz = this.z[q] - this.z[p], l = Math.hypot(dx, dz);
      this.tx[i] = dx / l; this.tz[i] = dz / l; this.slope[i] = (this.y[q] - this.y[p]) / (2 * this.ds);
      // Positive curvature = right-hand turn (right vector is (-tz, tx)).
      this.k[i] = curvature3(this.x[p], this.z[p], this.x[i], this.z[i], this.x[q], this.z[q]);
    }
    this.smooth(this.k, 4);
    this.tunnel = def.tunnel.map(f => f * total);
    this.sectors = [total / 3, total * 2 / 3, total];
    this.buildGrid(); this.buildRacingLine(); this.buildSpeedProfile(); this.buildCorners();
  }
  smooth(array, radius) {
    const N = array.length, copy = Float32Array.from(array);
    for (let i = 0; i < N; i++) { let sum = 0; for (let j = -radius; j <= radius; j++) sum += copy[(i + j + N) % N]; array[i] = sum / (radius * 2 + 1); }
  }
  wrap(s) { return ((s % this.length) + this.length) % this.length; }
  // Shortest signed distance from a to b along the lap.
  delta(a, b) { let d = this.wrap(b - a); if (d > this.length / 2) d -= this.length; return d; }
  at(array, s) {
    const f = this.wrap(s) / this.ds, i = Math.floor(f) % this.n, t = f - Math.floor(f);
    return array[i] + (array[(i + 1) % this.n] - array[i]) * t;
  }
  frame(s, d = 0, out = {}) {
    const f = this.wrap(s) / this.ds, i = Math.floor(f) % this.n, j = (i + 1) % this.n, t = f - Math.floor(f);
    let tx = lerp(this.tx[i], this.tx[j], t), tz = lerp(this.tz[i], this.tz[j], t); const l = Math.hypot(tx, tz); tx /= l; tz /= l;
    out.tx = tx; out.tz = tz; out.rx = -tz; out.rz = tx;
    out.x = lerp(this.x[i], this.x[j], t) + out.rx * d; out.z = lerp(this.z[i], this.z[j], t) + out.rz * d;
    out.y = lerp(this.y[i], this.y[j], t); out.slope = lerp(this.slope[i], this.slope[j], t); out.k = lerp(this.k[i], this.k[j], t);
    return out;
  }
  inTunnel(s) { s = this.wrap(s); return s > this.tunnel[0] && s < this.tunnel[1]; }
  buildGrid() {
    const cell = this.cell = 40, grid = this.grid = new Map();
    for (let i = 0; i < this.n; i++) {
      const key = Math.floor(this.x[i] / cell) + ',' + Math.floor(this.z[i] / cell);
      (grid.get(key) || grid.set(key, []).get(key)).push(i);
    }
  }
  // Nearest centreline sample to a world position: { s, d, distance }.
  locate(x, z, reach = 3) {
    const cx = Math.floor(x / this.cell), cz = Math.floor(z / this.cell); let best = -1, min = Infinity;
    for (let r = 0; r <= reach && (best < 0 || r <= 1); r++) for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) {
      if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue;
      const list = this.grid.get((cx + i) + ',' + (cz + j)); if (!list) continue;
      for (const index of list) { const d = (x - this.x[index]) ** 2 + (z - this.z[index]) ** 2; if (d < min) { min = d; best = index; } }
    }
    if (best < 0) return { s: 0, d: 0, distance: Infinity };
    const dx = x - this.x[best], dz = z - this.z[best];
    const along = dx * this.tx[best] + dz * this.tz[best], side = dx * -this.tz[best] + dz * this.tx[best];
    return { s: this.wrap(best * this.ds + along), d: side, distance: Math.abs(side), index: best };
  }
  // K1999-style curvature relaxation (after Rémi Coulom): each node moves across the track until its
  // curvature matches the mean of its neighbours, coarse to fine.
  buildRacingLine() {
    const N = this.n, d = new Float64Array(N), limit = this.halfWidth - 1.15;
    const px = i => this.x[i] - this.tz[i] * d[i], pz = i => this.z[i] + this.tx[i] * d[i];
    const kAt = (a, b, c) => curvature3(px(a), pz(a), px(b), pz(b), px(c), pz(c));
    const adjust = (i, step) => {
      const p = (i - step + N * 4) % N, q = (i + step) % N, pp = (i - 2 * step + N * 4) % N, qq = (i + 2 * step) % N;
      const target = (kAt(pp, p, i) + kAt(i, q, qq)) / 2;
      // Put the node on the chord p-q, then shift by the linearised curvature response.
      const ax = px(p), az = pz(p), bx = px(q), bz = pz(q), nx = -this.tz[i], nz = this.tx[i];
      const denom = nx * (bz - az) - nz * (bx - ax); if (Math.abs(denom) < 1e-9) return;
      d[i] = ((ax - this.x[i]) * (bz - az) - (az - this.z[i]) * (bx - ax)) / denom;
      const probe = .2; d[i] += probe; const response = kAt(p, i, q) / probe; d[i] -= probe;
      if (Math.abs(response) > 1e-9) d[i] += target / response;
      d[i] = clamp(d[i], -limit, limit);
    };
    for (const step of [32, 16, 8, 4, 2, 1]) {
      for (let iteration = 0; iteration < 120; iteration++) for (let i = 0; i < N; i += step) adjust(i, step);
      // Seed the next (finer) level by interpolating between the relaxed nodes.
      for (let i = 0; i < N; i += step) for (let j = 1; j < step; j++) d[i + j] = lerp(d[i], d[(i + step) % N], j / step);
    }
    for (let i = 0; i < N; i++) this.lineD[i] = d[i];
    for (let pass = 0; pass < 3; pass++) this.smooth(this.lineD, 4);
    for (let i = 0; i < N; i++) d[i] = this.lineD[i];
    for (let i = 0; i < N; i++) { const p = (i + N - 3) % N, q = (i + 3) % N; this.lineK[i] = kAt(p, i, q); }
    this.smooth(this.lineK, 3);
  }
  // Forward/backward pass over the racing line with a friction-circle budget.
  buildSpeedProfile(grip = 1) {
    const N = this.n, v = this.lineV, lat = 12.2 * grip, brake = 9.4 * grip, top = 83;
    for (let i = 0; i < N; i++) v[i] = Math.min(top, Math.sqrt(lat / Math.max(1e-4, Math.abs(this.lineK[i]))));
    const budget = (speed, k, a) => a * Math.sqrt(Math.max(.04, 1 - Math.min(1, (speed * speed * Math.abs(k) / lat) ** 2)));
    for (let pass = 0; pass < 2; pass++) for (let i = N * 2 - 1; i >= 0; i--) {
      const a = i % N, b = (i + 1) % N;
      v[a] = Math.min(v[a], Math.sqrt(v[b] ** 2 + 2 * budget(v[b], this.lineK[b], brake + .0012 * v[b] ** 2) * this.ds));
    }
    for (let pass = 0; pass < 2; pass++) for (let i = 0; i < N * 2; i++) {
      const a = i % N, b = (i + 1) % N, drive = Math.min(8.6 * grip, 150000 / (272 * Math.max(8, v[a]))) - .00068 * v[a] ** 2;
      v[b] = Math.min(v[b], Math.sqrt(v[a] ** 2 + 2 * budget(v[a], this.lineK[a], Math.max(.2, drive)) * this.ds));
    }
  }
  // Corners are found from centreline curvature; a corner ends when the track straightens or the direction flips.
  buildCorners() {
    const N = this.n, names = this.def.cornerNames || [], list = []; let open = null;
    for (let i = 0; i <= N; i++) {
      const k = this.k[i % N], sign = Math.sign(k), active = Math.abs(k) > .006;
      if (open && (!active || sign !== open.dir)) { if (open.end - open.start > 30) list.push(open); open = null; }
      if (active && !open) open = { start: i * this.ds, end: i * this.ds, apex: i * this.ds, peak: 0, dir: sign };
      if (open) { open.end = i * this.ds; if (Math.abs(k) > open.peak) { open.peak = Math.abs(k); open.apex = i * this.ds; } }
    }
    this.corners = list.map((c, i) => ({ ...c, number: i + 1, name: names[i] || '', radius: 1 / c.peak }));
  }
  nextCorner(s) {
    s = this.wrap(s); let best = null, min = Infinity;
    for (const c of this.corners) { const gap = this.wrap(c.start - s); const inside = this.wrap(s - c.start) < c.end - c.start; const dist = inside ? 0 : gap; if (dist < min) { min = dist; best = c; } }
    return best ? { corner: best, distance: min } : null;
  }
  // Tunnel weight: 1 inside, easing to 0 over `ramp` metres either side.
  tunnelWeight(s, ramp = 40) {
    s = this.wrap(s); const [a, b] = this.tunnel;
    return s < a ? smoothstep(a - ramp, a, s) : s > b ? 1 - smoothstep(b, b + ramp, s) : 1;
  }
  // Lateral distance from the centreline to the barrier.
  barrier(s) { return lerp(this.halfWidth + this.def.runoff, this.halfWidth + 1.4, this.tunnelWeight(s)); }
  // Surface under a lateral offset: asphalt, kerb, runoff (paved), gravel (outside of corners) or grass.
  surface(s, d) {
    const a = Math.abs(d), hw = this.halfWidth; if (a <= hw) return 'asphalt'; if (a <= hw + 1.1) return 'kerb';
    if (this.tunnelWeight(s) > .5 || a <= hw + 3) return 'runoff';
    const k = this.at(this.k, s + 25); return Math.abs(k) > .0045 && Math.sign(k) !== Math.sign(d) ? 'gravel' : 'grass';
  }
  minimap(count = 240) { return Array.from({ length: count }, (_, i) => { const j = Math.floor(i / count * this.n); return [this.x[j], this.z[j]]; }); }
}
