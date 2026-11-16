// TFT cluster renderer. Pure Canvas 2D at a fixed 1280x480 logical resolution, driven only by the
// ClusterModel view. The same canvas feeds the on-screen HUD and the 3D dashboard texture.
import { tr } from './i18n.mjs';
import { PAGES } from './model.mjs';

export const W = 1280, H = 480;
const NUM = '"Bahnschrift","DIN Alternate","Roboto Condensed","Arial Narrow","Helvetica Neue",Arial,sans-serif';
const TXT = '"PingFang SC","Microsoft YaHei","Noto Sans CJK SC","Source Han Sans SC","Segoe UI",sans-serif';
const DAY = { bg0: [244, 246, 248], bg1: [214, 221, 229], panel: [255, 255, 255], ink: [10, 15, 21], dim: [84, 96, 110], line: [186, 196, 207], ghost: [200, 208, 217] };
const NIGHT = { bg0: [3, 6, 10], bg1: [13, 20, 29], panel: [15, 23, 33], ink: [240, 246, 250], dim: [124, 139, 154], line: [36, 49, 63], ghost: [26, 36, 47] };
const ACCENT = { ROAD: [[0, 122, 214], [20, 190, 255]], SPORT: [[226, 30, 24], [255, 64, 48]], RAIN: [[36, 98, 232], [78, 150, 255]] };
const GREEN = [[18, 150, 84], [48, 214, 128]], AMBER = [[214, 130, 0], [255, 184, 28]], RED = [[214, 24, 24], [255, 56, 56]], BLUE = [[20, 90, 230], [70, 140, 255]];
const TAU = Math.PI * 2, rad = d => d * Math.PI / 180;
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const css = (c, alpha = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${alpha})`;
const lapTime = s => s > 0 ? `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, '0')}` : '-:--.--';

export class ClusterRenderer {
  constructor(canvas) { this.canvas = canvas; canvas.width = W; canvas.height = H; this.ctx = canvas.getContext('2d'); this.drawMs = 0; }
  color(pair, alpha = 1) { return css(mix(pair[0], pair[1], this.t), alpha); }
  text(value, x, y, size, color, align = 'left', font = TXT, weight = 600, style = '') {
    const c = this.ctx; c.font = `${style} ${weight} ${size}px ${font}`; c.textAlign = align; c.fillStyle = color; c.fillText(value, x, y);
  }
  round(x, y, w, h, r) { const c = this.ctx; c.beginPath(); c.roundRect(x, y, w, h, r); }
  draw(view) {
    const start = performance.now(), c = this.ctx, t = this.t = view.themeMix; this.view = view; this.lang = view.settings.lang;
    const p = this.p = {}; for (const key in DAY) p[key] = mix(DAY[key], NIGHT[key], t);
    this.accent = ACCENT[view.mode] ?? ACCENT.SPORT;
    c.setTransform(1, 0, 0, 1, 0, 0); c.textBaseline = 'alphabetic'; c.lineCap = 'butt'; c.lineJoin = 'round'; c.globalAlpha = 1;
    if (view.power === 'off') { c.fillStyle = '#000'; c.fillRect(0, 0, W, H); this.drawMs = performance.now() - start; return; }
    if (view.power === 'boot') { this.boot(view.powerTime); this.drawMs = performance.now() - start; return; }
    const bg = c.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, css(p.bg0)); bg.addColorStop(1, css(p.bg1)); c.fillStyle = bg; c.fillRect(0, 0, W, H);
    const glow = c.createRadialGradient(640, 250, 20, 640, 250, 520); glow.addColorStop(0, this.color(this.accent, .10 + .06 * t)); glow.addColorStop(1, this.color(this.accent, 0)); c.fillStyle = glow; c.fillRect(0, 0, W, H);
    this.header(); this.footer();
    if (view.mode === 'ROAD') this.road(); else if (view.mode === 'RAIN') this.rain(); else this.sport();
    this.widget(990, 184, 242, 240);
    if (view.popup) this.popup(view.popup);
    if (view.power === 'check') { c.globalAlpha = Math.max(0, 1 - view.powerTime * 2.2); c.fillStyle = '#000'; c.fillRect(0, 0, W, H); c.globalAlpha = 1; this.text(tr(this.lang, 'selfcheck'), 640, 426, 16, css(p.dim), 'center'); }
    this.drawMs = performance.now() - start;
  }
  boot(time) {
    const c = this.ctx; c.fillStyle = '#000'; c.fillRect(0, 0, W, H);
    const a = Math.min(1, time / .5), out = Math.max(0, (time - 1.25) / .25);
    c.save(); c.globalAlpha = a * (1 - out); c.translate(640, 196); c.scale(5.2, 5.2); c.translate(-15, -15);
    const logo = new Path2D('M3 25 15 4l12 21H3Zm8-5h8l-4-7-4 7Z'); c.fillStyle = '#ff4030'; c.fill(logo, 'evenodd'); c.restore();
    c.globalAlpha = a * (1 - out); this.text('A P E X', 640, 318, 44, '#f4f7fa', 'center', NUM, 700, 'italic'); this.text('MOTO  HMI', 640, 350, 15, '#7d8a98', 'center', NUM, 600);
    c.fillStyle = '#18222c'; c.fillRect(480, 384, 320, 3); c.fillStyle = '#ff4030'; c.fillRect(480, 384, 320 * Math.min(1, time / 1.2), 3);
    const sweep = (time / 1.3) * (W + 400) - 200, g = c.createLinearGradient(sweep - 160, 0, sweep + 160, 0); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(.5, 'rgba(255,255,255,.10)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g; c.fillRect(0, 0, W, H); c.globalAlpha = 1;
  }

  // ---- telltales ---------------------------------------------------------------------------------
  header() {
    const v = this.view.telltales, c = this.ctx, p = this.p;
    c.fillStyle = css(p.panel, .55 - .2 * this.t); c.fillRect(0, 0, W, 56); c.fillStyle = css(p.line, .9); c.fillRect(0, 56, W, 1);
    const icon = (name, x, on, pair) => { this.icon(name, x, 28, on ? this.color(pair) : css(p.ghost, .9), on); };
    icon('left', 64, v.left, GREEN); icon('right', W - 64, v.right, GREEN); icon('beam', W - 150, v.highBeam, BLUE);
    const group = [['abs', v.abs, AMBER], ['tcs', v.tcs, AMBER], ['mil', v.mil, AMBER], ['oil', v.oil, RED], ['temp', v.temp, RED], ['fuel', v.fuel, AMBER], ['tpms', v.tpms, AMBER], ['battery', v.battery, RED]];
    group.forEach(([name, on, pair], i) => icon(name, 640 - 62 * 4 + i * 62, on, pair));
    icon('master', 640 + 62 * 4, !!v.master, v.master === 'amber' ? AMBER : RED);
    if (v.master === 'dim') this.icon('master', 640 + 62 * 4, 28, this.color(RED, .35), false);
    this.text(this.clockText(), 150, 36, 22, css(p.ink), 'left', NUM, 600);
    if (this.view.ambientTemp !== null) this.text(this.temp(this.view.ambientTemp), 238, 36, 18, css(p.dim), 'left', NUM, 600);
  }
  clockText() { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }
  temp(celsius) { return this.view.settings.units === 'imperial' ? `${Math.round(celsius * 1.8 + 32)}°F` : `${Math.round(celsius)}°C`; }
  icon(name, x, y, color, lit) {
    const c = this.ctx; c.save(); c.translate(x, y); c.strokeStyle = c.fillStyle = color; c.lineWidth = 2.6;
    if (lit) { c.shadowColor = color; c.shadowBlur = 12; }
    const label = (s, size = 11) => { c.shadowBlur = 0; c.font = `800 ${size}px ${NUM}`; c.textAlign = 'center'; c.fillText(s, 0, size * .36); };
    switch (name) {
      case 'left': case 'right': { const k = name === 'left' ? -1 : 1; c.beginPath(); c.moveTo(k * 18, 0); c.lineTo(k * 2, -15); c.lineTo(k * 2, -7); c.lineTo(-k * 16, -7); c.lineTo(-k * 16, 7); c.lineTo(k * 2, 7); c.lineTo(k * 2, 15); c.closePath(); c.fill(); break; }
      case 'beam': c.beginPath(); c.moveTo(2, -12); c.quadraticCurveTo(18, 0, 2, 12); c.closePath(); c.fill(); for (let i = -2; i <= 2; i++) { c.beginPath(); c.moveTo(-4, i * 5.5); c.lineTo(-18, i * 5.5); c.stroke(); } break;
      case 'abs': case 'tcs': c.beginPath(); c.arc(0, 0, 12.5, 0, TAU); c.stroke(); c.beginPath(); c.arc(0, 0, 17.5, rad(130), rad(230)); c.stroke(); c.beginPath(); c.arc(0, 0, 17.5, rad(-50), rad(50)); c.stroke(); label(name === 'abs' ? 'ABS' : 'TC', name === 'abs' ? 10 : 12); break;
      case 'mil': c.beginPath(); c.moveTo(-14, -3); c.lineTo(-9, -3); c.lineTo(-9, -8); c.lineTo(-3, -8); c.lineTo(-3, -12); c.lineTo(7, -12); c.lineTo(7, -8); c.lineTo(11, -8); c.lineTo(15, -2); c.lineTo(18, -2); c.lineTo(18, 8); c.lineTo(15, 8); c.lineTo(12, 12); c.lineTo(-6, 12); c.lineTo(-9, 8); c.lineTo(-14, 8); c.closePath(); c.stroke(); break;
      case 'oil': c.beginPath(); c.moveTo(-16, -4); c.lineTo(-8, -4); c.lineTo(-4, -1); c.lineTo(8, -1); c.lineTo(17, -8); c.lineTo(19, -6); c.lineTo(11, 3); c.lineTo(9, 9); c.lineTo(-12, 9); c.lineTo(-12, 1); c.closePath(); c.stroke(); c.beginPath(); c.arc(19, 5, 2.2, 0, TAU); c.fill(); c.beginPath(); c.moveTo(-9, -4); c.lineTo(-9, -9); c.moveTo(-13, -9); c.lineTo(-5, -9); c.stroke(); break;
      case 'temp': c.beginPath(); c.moveTo(0, -14); c.lineTo(0, 3); c.stroke(); c.beginPath(); c.arc(0, 6, 4.5, 0, TAU); c.fill(); c.beginPath(); c.moveTo(1, -11); c.lineTo(8, -11); c.moveTo(1, -5); c.lineTo(8, -5); c.stroke();
        for (const yy of [12]) { c.beginPath(); c.moveTo(-16, yy); c.quadraticCurveTo(-12, yy - 4, -8, yy); c.quadraticCurveTo(-4, yy + 4, 0, yy); c.quadraticCurveTo(4, yy - 4, 8, yy); c.quadraticCurveTo(12, yy + 4, 16, yy); c.stroke(); } break;
      case 'fuel': c.beginPath(); c.roundRect(-11, -13, 14, 26, 2); c.stroke(); c.fillRect(-8, -10, 8, 7); c.beginPath(); c.moveTo(3, -4); c.lineTo(9, -4); c.lineTo(9, 9); c.quadraticCurveTo(9, 12, 12, 12); c.quadraticCurveTo(15, 12, 15, 9); c.lineTo(15, -6); c.lineTo(10, -11); c.stroke(); break;
      case 'tpms': c.beginPath(); c.moveTo(-9, -13); c.quadraticCurveTo(-18, 0, -11, 11); c.lineTo(11, 11); c.quadraticCurveTo(18, 0, 9, -13); c.stroke(); for (let i = -2; i <= 2; i++) { c.beginPath(); c.moveTo(i * 5, 11); c.lineTo(i * 5, 15); c.stroke(); } label('!', 17); break;
      case 'battery': c.beginPath(); c.rect(-15, -8, 30, 19); c.stroke(); c.fillRect(-11, -12, 6, 4); c.fillRect(5, -12, 6, 4); c.beginPath(); c.moveTo(-10, 1); c.lineTo(-4, 1); c.moveTo(4, 1); c.lineTo(10, 1); c.moveTo(7, -2); c.lineTo(7, 4); c.stroke(); break;
      case 'master': c.beginPath(); c.moveTo(0, -15); c.lineTo(17, 13); c.lineTo(-17, 13); c.closePath(); c.stroke(); c.translate(0, 3); label('!', 17); break;
    }
    c.restore();
  }

  // ---- shared widgets ----------------------------------------------------------------------------
  speedBlock(x, baseline, size) {
    const v = this.view, p = this.p, imperial = v.settings.units === 'imperial', value = v.speed.valid ? String(Math.round(v.speed.value * (imperial ? .621371 : 1))) : '---';
    this.text(value, x, baseline, size, css(v.speed.valid ? p.ink : p.dim), 'center', NUM, 700, 'italic');
    this.text(tr(this.lang, imperial ? 'speed_mph' : 'speed_kmh'), x, baseline + 34, 20, css(p.dim), 'center', NUM, 600);
    if (!v.speed.valid) this.text(tr(this.lang, 'nodata'), x, baseline - size * .86, 15, this.color(RED), 'center');
  }
  gearBlock(x, y, w, h, size) {
    const v = this.view, c = this.ctx, p = this.p, flash = v.shift >= 1 && Math.floor(v.clock * 14) % 2 === 0, hot = v.shift > .55;
    this.round(x, y, w, h, 16); c.fillStyle = flash ? this.color(RED) : css(p.panel, .78); c.fill(); c.lineWidth = 3; c.strokeStyle = hot ? this.color(RED) : this.color(this.accent); c.stroke();
    this.text(v.gear === null ? '-' : v.gear === 0 ? 'N' : String(v.gear), x + w / 2, y + h / 2 + size * .36, size, flash ? '#fff' : css(p.ink), 'center', NUM, 700, 'italic');
    this.text(tr(this.lang, 'gear'), x + w / 2, y - 10, 14, css(p.dim), 'center');
  }
  bar(x, y, w, h, fraction, color, reverse = false) {
    const c = this.ctx; this.round(x, y, w, h, h / 2); c.fillStyle = css(this.p.line, .9); c.fill();
    const fill = Math.max(0, Math.min(1, fraction)) * w; if (fill < 1) return;
    this.round(reverse ? x + w - fill : x, y, fill, h, h / 2); c.fillStyle = color; c.fill();
  }
  footer() {
    const v = this.view, c = this.ctx, p = this.p, y = 436, lang = this.lang;
    c.fillStyle = css(p.panel, .55 - .2 * this.t); c.fillRect(0, y, W, H - y); c.fillStyle = css(p.line, .9); c.fillRect(0, y, W, 1);
    const low = v.fuel.valid && v.fuel.value < 12, hot = v.coolant.valid && v.coolant.value >= 108;
    this.text(tr(lang, 'fuel'), 48, 465, 15, css(p.dim)); this.bar(96, 453, 120, 10, v.fuel.valid ? v.fuel.value / 100 : 0, low ? this.color(AMBER) : css(p.ink));
    this.text(v.range !== null ? `${Math.round(v.range)} km` : v.fuel.valid ? `${Math.round(v.fuel.value)}%` : '--', 228, 465, 17, css(p.ink), 'left', NUM, 600);
    this.text(tr(lang, 'coolant'), 318, 465, 15, css(p.dim)); this.bar(366, 453, 120, 10, v.coolant.valid ? (v.coolant.value - 40) / 90 : 0, hot ? this.color(RED) : css(p.ink));
    this.text(v.coolant.valid ? this.temp(v.coolant.value) : '--', 498, 465, 17, css(hot ? mix(RED[0], RED[1], this.t) : p.ink), 'left', NUM, 600);
    // Mode / TCS / ABS chips
    const chip = (x, w, label, pair, filled) => { this.round(x, 446, w, 26, 13); if (filled) { c.fillStyle = this.color(pair); c.fill(); } else { c.lineWidth = 1.5; c.strokeStyle = this.color(pair); c.stroke(); } this.text(label, x + w / 2, 465, 15, filled ? '#fff' : this.color(pair), 'center', NUM, 700); };
    chip(590, 100, v.mode, this.accent, true);
    const tcsState = v.tcs.fault ? AMBER : v.tcs.active && v.blink ? AMBER : [p.dim, p.dim];
    chip(700, 84, v.tcs.fault ? 'TCS !' : `TCS ${v.tcs.level ?? '-'}`, tcsState, v.tcs.active && v.blink);
    chip(794, 72, v.abs.fault ? 'ABS !' : 'ABS', v.abs.fault ? AMBER : v.abs.active && v.blink ? AMBER : [p.dim, p.dim], v.abs.active && v.blink);
    chip(876, 72, 'AWC', v.awc ? AMBER : [p.dim, p.dim], v.awc);
    const odo = v.trip.odometer, imperial = v.settings.units === 'imperial';
    this.text(tr(lang, 'odo'), 1010, 465, 15, css(p.dim)); this.text(odo === null ? '--' : `${(odo * (imperial ? .621371 : 1)).toFixed(1)} ${imperial ? 'mi' : 'km'}`, 1232, 465, 17, css(p.ink), 'right', NUM, 600);
  }

  // ---- SPORT: sweeping bar tach, lap timing --------------------------------------------------------
  tachBar() {
    const v = this.view, c = this.ctx, p = this.p, x0 = 48, x1 = 1232, base = 150, n = 70, fraction = Math.min(1, v.rpm.value / 14000);
    const top = f => base - 22 - 58 * f ** 1.6, flash = v.shift >= 1 && Math.floor(v.clock * 14) % 2 === 0;
    for (let i = 0; i < n; i++) {
      const f0 = i / n, f1 = (i + 1) / n, xa = x0 + (x1 - x0) * f0 + 2, xb = x0 + (x1 - x0) * f1 - 2, lit = v.rpm.valid && f1 <= fraction + .5 / n;
      const zone = f0 >= 13000 / 14000 ? RED : f0 >= 11000 / 14000 ? AMBER : null;
      c.beginPath(); c.moveTo(xa + 5, top(f0)); c.lineTo(xb + 5, top(f1)); c.lineTo(xb, base); c.lineTo(xa, base); c.closePath();
      c.fillStyle = lit ? (flash ? this.color(RED) : zone ? this.color(zone) : css(p.ink)) : zone ? this.color(zone, .22) : css(p.line, .8); c.fill();
    }
    for (let k = 0; k <= 14; k++) { const x = x0 + (x1 - x0) * k / 14; this.text(String(k), x, base + 22, 16, k >= 13 ? this.color(RED) : css(p.dim), 'center', NUM, 700); }
    this.text(v.rpm.valid ? `${Math.round(v.rpm.value / 10) * 10}` : '----', 48, 96, 26, css(p.ink), 'left', NUM, 700, 'italic'); this.text('rpm', 48, 116, 14, css(p.dim), 'left', NUM, 600);
  }
  lapPanel(x, y) {
    const v = this.view, p = this.p, lap = v.lap, lang = this.lang;
    this.text(tr(lang, 'pos'), x, y + 16, 14, css(p.dim)); this.text(tr(lang, 'lap'), x + 170, y + 16, 14, css(p.dim));
    this.text(lap.valid && lap.position ? `P${lap.position}` : 'P-', x, y + 62, 46, css(p.ink), 'left', NUM, 700, 'italic');
    this.text(lap.entrants ? `/${lap.entrants}` : '', x + 78, y + 62, 22, css(p.dim), 'left', NUM, 600);
    this.text(lap.valid ? `${lap.number}` : '-', x + 170, y + 62, 46, css(p.ink), 'left', NUM, 700, 'italic');
    this.text(lap.total ? `/${lap.total}` : '', x + 204, y + 62, 22, css(p.dim), 'left', NUM, 600);
    this.text(tr(lang, 'current'), x, y + 96, 14, css(p.dim)); this.text(lapTime(lap.time), x, y + 142, 46, css(p.ink), 'left', NUM, 700);
    if (lap.best > 0 && lap.number > 1) {
      const ahead = lap.delta <= 0, pair = ahead ? GREEN : RED; this.round(x + 208, y + 108, 104, 34, 8); this.ctx.fillStyle = this.color(pair); this.ctx.fill();
      this.text(`${ahead ? '-' : '+'}${Math.abs(lap.delta).toFixed(2)}`, x + 260, y + 133, 22, '#fff', 'center', NUM, 700);
    }
    this.text(tr(lang, 'last'), x, y + 180, 14, css(p.dim)); this.text(lapTime(lap.last), x + 58, y + 181, 22, css(p.ink), 'left', NUM, 600);
    this.text(tr(lang, 'best'), x, y + 212, 14, css(p.dim)); this.text(lapTime(lap.best), x + 58, y + 213, 22, this.color(lap.best > 0 ? [[150, 40, 200], [200, 120, 255]] : [p.dim, p.dim]), 'left', NUM, 600);
    for (let i = 0; i < 3; i++) { this.round(x + 208 + i * 36, y + 198, 30, 8, 4); this.ctx.fillStyle = i < lap.sector ? this.color(GREEN) : i === lap.sector && v.blink ? this.color(this.accent) : css(p.line); this.ctx.fill(); }
    this.text(tr(lang, 'sector'), x + 208, y + 181, 14, css(p.dim));
  }
  pedals(y) {
    const v = this.view, p = this.p;
    this.bar(440, y, 190, 10, v.brake / 100, this.color(RED), true); this.bar(650, y, 190, 10, v.throttle / 100, this.color(GREEN));
    this.text(tr(this.lang, 'brake'), 440, y - 8, 13, css(p.dim)); this.text(tr(this.lang, 'throttle'), 840, y - 8, 13, css(p.dim), 'right');
  }
  sport() { this.tachBar(); this.lapPanel(48, 192); this.speedBlock(590, 338, 172); this.gearBlock(800, 212, 138, 150, 128); this.pedals(410); }

  // ---- ROAD: round tach ---------------------------------------------------------------------------
  road() {
    const v = this.view, c = this.ctx, p = this.p, cx = 236, cy = 256, R = 164, a0 = rad(140), a1 = rad(400), angle = f => a0 + (a1 - a0) * f;
    c.lineWidth = 20; c.strokeStyle = css(p.line, .85); c.beginPath(); c.arc(cx, cy, R - 10, a0, a1); c.stroke();
    c.strokeStyle = this.color(RED, .5); c.beginPath(); c.arc(cx, cy, R - 10, angle(13 / 14), a1); c.stroke();
    if (v.rpm.valid) { c.strokeStyle = v.shift > .55 ? this.color(RED) : this.color(this.accent); c.beginPath(); c.arc(cx, cy, R - 10, a0, angle(Math.min(1, v.rpm.value / 14000))); c.stroke(); }
    for (let k = 0; k <= 14; k++) {
      const a = angle(k / 14), major = k % 2 === 0; c.lineWidth = major ? 3 : 1.5; c.strokeStyle = css(p.ink, major ? .9 : .5);
      c.beginPath(); c.moveTo(cx + Math.cos(a) * (R - 26), cy + Math.sin(a) * (R - 26)); c.lineTo(cx + Math.cos(a) * (R - (major ? 42 : 34)), cy + Math.sin(a) * (R - (major ? 42 : 34))); c.stroke();
      if (major) this.text(String(k), cx + Math.cos(a) * (R - 60), cy + Math.sin(a) * (R - 60) + 7, 20, k >= 13 ? this.color(RED) : css(p.ink), 'center', NUM, 700);
    }
    const a = angle(Math.min(1, v.rpm.value / 14000)); c.lineWidth = 5; c.strokeStyle = this.color(RED); c.lineCap = 'round';
    c.beginPath(); c.moveTo(cx + Math.cos(a) * 62, cy + Math.sin(a) * 62); c.lineTo(cx + Math.cos(a) * (R - 22), cy + Math.sin(a) * (R - 22)); c.stroke(); c.lineCap = 'butt';
    c.beginPath(); c.arc(cx, cy, 56, 0, TAU); c.fillStyle = css(p.panel, .9); c.fill(); c.lineWidth = 2; c.strokeStyle = css(p.line); c.stroke();
    this.text(v.gear === null ? '-' : v.gear === 0 ? 'N' : String(v.gear), cx, cy + 26, 74, css(p.ink), 'center', NUM, 700, 'italic');
    this.text('×1000 rpm', cx, cy + 118, 14, css(p.dim), 'center', NUM, 600);
    this.speedBlock(690, 330, 180);
    const lang = this.lang, cons = v.trip.consumption;
    this.text(tr(lang, 'range'), 560, 408, 14, css(p.dim), 'right'); this.text(v.range !== null ? `${Math.round(v.range)} km` : '--', 570, 409, 22, css(p.ink), 'left', NUM, 600);
    this.text(tr(lang, 'avg_fuel'), 760, 408, 14, css(p.dim), 'right'); this.text(cons !== null ? `${cons.toFixed(1)} L/100` : '--', 770, 409, 22, css(p.ink), 'left', NUM, 600);
  }

  // ---- RAIN: calm layout, traction emphasised -----------------------------------------------------
  rain() {
    const v = this.view, c = this.ctx, p = this.p, cx = 660, cy = 262, R = 158, a0 = rad(135), a1 = rad(405), lang = this.lang;
    c.lineWidth = 10; c.strokeStyle = css(p.line, .85); c.beginPath(); c.arc(cx, cy, R, a0, a1); c.stroke();
    if (v.rpm.valid) { c.strokeStyle = this.color(this.accent); c.lineCap = 'round'; c.beginPath(); c.arc(cx, cy, R, a0, a0 + (a1 - a0) * Math.min(1, v.rpm.value / 14000)); c.stroke(); c.lineCap = 'butt'; }
    this.speedBlock(cx, 306, 150);
    this.text(`${tr(lang, 'gear')} ${v.gear === null ? '-' : v.gear === 0 ? 'N' : v.gear}`, cx, 398, 24, css(p.ink), 'center', NUM, 700);
    const x = 48, y = 196, level = v.tcs.level ?? 0;
    this.text(tr(lang, 'tcs'), x, y + 16, 15, css(p.dim)); this.text(v.tcs.fault ? '!' : String(v.tcs.level ?? '-'), x, y + 86, 72, v.tcs.fault ? this.color(AMBER) : css(p.ink), 'left', NUM, 700, 'italic');
    for (let i = 0; i < 8; i++) { this.round(x + 70 + i * 34, y + 46 + (7 - i) * 3, 26, 40 - (7 - i) * 3, 4); c.fillStyle = i < level ? (v.tcs.active && v.blink ? this.color(AMBER) : this.color(this.accent)) : css(p.line); c.fill(); }
    this.text(tr(lang, 'grip'), x, y + 130, 15, css(p.dim)); this.bar(x, y + 142, 330, 12, v.grip / 100, v.grip > 85 ? this.color(AMBER) : this.color(this.accent));
    this.text(`${Math.round(v.grip)}%`, x + 330, y + 130, 18, css(p.ink), 'right', NUM, 600);
    c.beginPath(); c.moveTo(x + 10, y + 184); c.bezierCurveTo(x + 24, y + 204, x + 22, y + 214, x + 10, y + 214); c.bezierCurveTo(x - 2, y + 214, x - 4, y + 204, x + 10, y + 184); c.fillStyle = this.color(this.accent); c.fill();
    this.text(tr(lang, 'wet'), x + 34, y + 208, 16, css(p.ink));
  }

  // ---- right-hand info pages ----------------------------------------------------------------------
  widget(x, y, w, h) {
    const v = this.view, c = this.ctx, p = this.p, lang = this.lang, title = { lean: 'lean', tyres: 'tyres', nav: 'nav', trip: 'trip', dtc: 'dtc' }[v.page];
    this.round(x - 14, y - 6, w + 28, h + 8, 14); c.fillStyle = css(p.panel, .62 - .2 * this.t); c.fill(); c.lineWidth = 1; c.strokeStyle = css(p.line); c.stroke();
    this.text(tr(lang, title), x, y + 20, 16, css(p.dim));
    PAGES.forEach((name, i) => { c.beginPath(); c.arc(x + w - (PAGES.length - 1 - i) * 14, y + 14, name === v.page ? 4 : 2.5, 0, TAU); c.fillStyle = name === v.page ? this.color(this.accent) : css(p.dim, .6); c.fill(); });
    const imperial = v.settings.units === 'imperial';
    if (v.page === 'lean') {
      const cx = x + w / 2, cy = y + 150, R = 96, value = v.lean.valid ? v.lean.value : 0, ang = d => rad(-90 + d);
      c.lineWidth = 6; c.strokeStyle = css(p.line); c.beginPath(); c.arc(cx, cy, R, ang(-62), ang(62)); c.stroke();
      c.strokeStyle = this.color(Math.abs(value) > 50 ? RED : this.accent); c.beginPath(); c.arc(cx, cy, R, ang(Math.min(0, value)), ang(Math.max(0, value))); c.stroke();
      for (const d of [-60, -40, -20, 0, 20, 40, 60]) { const a = ang(d); c.lineWidth = 2; c.strokeStyle = css(p.dim); c.beginPath(); c.moveTo(cx + Math.cos(a) * (R + 6), cy + Math.sin(a) * (R + 6)); c.lineTo(cx + Math.cos(a) * (R + 13), cy + Math.sin(a) * (R + 13)); c.stroke(); }
      for (const [d, side] of [[-v.lean.left, 'L'], [v.lean.right, 'R']]) { const a = ang(Math.max(-62, Math.min(62, d))); c.beginPath(); c.arc(cx + Math.cos(a) * R, cy + Math.sin(a) * R, 4, 0, TAU); c.fillStyle = css(p.ink); c.fill(); }
      // Bike seen from behind, rotated about the contact patch.
      c.save(); c.translate(cx, cy + 6); c.rotate(rad(value)); c.fillStyle = css(p.ink); this.round(-9, -56, 18, 56, 8); c.fill(); this.round(-17, -76, 34, 26, 8); c.fill(); c.beginPath(); c.arc(0, -86, 11, 0, TAU); c.fill();
      c.fillRect(-30, -62, 60, 4); c.restore(); c.fillStyle = css(p.dim); c.fillRect(cx - 60, cy + 7, 120, 2);
      this.text(v.lean.valid ? `${Math.abs(Math.round(value))}°` : '--', cx, cy + 50, 40, css(p.ink), 'center', NUM, 700, 'italic');
      this.text(`${tr(lang, 'max_l')} ${Math.round(v.lean.left)}°`, x, y + h - 10, 14, css(p.dim)); this.text(`${tr(lang, 'max_r')} ${Math.round(v.lean.right)}°`, x + w, y + h - 10, 14, css(p.dim), 'right');
    } else if (v.page === 'tyres') {
      const tyre = (ty, label, pressure, temperature, low, critical) => {
        const state = pressure === null ? [p.dim, p.dim] : pressure < critical ? RED : pressure < low ? AMBER : GREEN;
        this.round(x + 8, ty, 46, 78, 16); c.lineWidth = 5; c.strokeStyle = this.color(state); c.stroke(); for (let i = 1; i < 5; i++) { c.fillStyle = this.color(state, .5); c.fillRect(x + 16, ty + i * 15, 30, 3); }
        this.text(label, x + 31, ty - 8, 14, css(p.dim), 'center');
        this.text(pressure === null ? '--' : imperial ? (pressure * 14.5038).toFixed(0) : pressure.toFixed(2), x + 74, ty + 40, 40, this.color(state === GREEN ? [p.ink, p.ink] : state), 'left', NUM, 700, 'italic');
        this.text(imperial ? 'psi' : 'bar', x + w, ty + 22, 15, css(p.dim), 'right', NUM, 600); this.text(temperature === null ? '--' : this.temp(temperature), x + w, ty + 62, 18, css(p.dim), 'right', NUM, 600);
      };
      tyre(y + 50, tr(lang, 'front'), v.tyres.front, v.tyres.frontTemp, 2.0, 1.6); tyre(y + 152, tr(lang, 'rear'), v.tyres.rear, v.tyres.rearTemp, 2.3, 1.8);
    } else if (v.page === 'nav') {
      const map = v.nav.map; if (map.length) {
        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity; for (const [mx, mz] of map) { minX = Math.min(minX, mx); maxX = Math.max(maxX, mx); minZ = Math.min(minZ, mz); maxZ = Math.max(maxZ, mz); }
        const scale = Math.min((w - 16) / (maxX - minX), 128 / (maxZ - minZ)), ox = x + w / 2 - (minX + maxX) / 2 * scale, oy = y + 96 - (minZ + maxZ) / 2 * scale;
        c.beginPath(); map.forEach(([mx, mz], i) => i ? c.lineTo(ox + mx * scale, oy + mz * scale) : c.moveTo(ox + mx * scale, oy + mz * scale)); c.closePath(); c.lineWidth = 5; c.strokeStyle = css(p.line); c.stroke(); c.lineWidth = 1.5; c.strokeStyle = css(p.dim); c.stroke();
        if (v.nav.valid) { const [mx, mz] = map[Math.floor(v.nav.position * map.length) % map.length]; c.beginPath(); c.arc(ox + mx * scale, oy + mz * scale, 6, 0, TAU); c.fillStyle = this.color(this.accent); c.fill(); c.lineWidth = 2; c.strokeStyle = '#fff'; c.stroke(); }
      }
      const dir = v.nav.direction, ax = x + 22, ay = y + 198; c.save(); c.translate(ax, ay); if (dir === 1) c.scale(-1, 1); c.strokeStyle = this.color(this.accent); c.lineWidth = 6; c.lineCap = 'round';
      c.beginPath(); if (dir) { c.moveTo(-10, 18); c.lineTo(-10, 0); c.quadraticCurveTo(-10, -10, 2, -10); c.lineTo(12, -10); c.moveTo(5, -18); c.lineTo(13, -10); c.lineTo(5, -2); } else { c.moveTo(0, 18); c.lineTo(0, -16); c.moveTo(-8, -8); c.lineTo(0, -16); c.lineTo(8, -8); } c.stroke(); c.restore();
      this.text(dir ? `T${v.nav.number}` : tr(lang, 'straight'), x + 52, y + 194, 22, css(p.ink), 'left', NUM, 700); this.text(v.nav.valid ? `${Math.round(v.nav.distance / 10) * 10} m` : '--', x + 52, y + 220, 20, css(p.dim), 'left', NUM, 600);
      this.text(tr(lang, 'advise'), x + w, y + 190, 14, css(p.dim), 'right'); this.text(v.nav.valid && v.nav.advise ? String(Math.round(v.nav.advise * (imperial ? .621371 : 1))) : '--', x + w, y + 222, 30, css(p.ink), 'right', NUM, 700, 'italic');
    } else if (v.page === 'trip') {
      const k = imperial ? .621371 : 1, rows = [['trip_dist', `${(v.trip.distance * k).toFixed(1)} ${imperial ? 'mi' : 'km'}`], ['avg_speed', v.trip.avgSpeed === null ? '--' : `${Math.round(v.trip.avgSpeed * k)} ${imperial ? 'mph' : 'km/h'}`],
        ['avg_fuel', v.trip.consumption === null ? '--' : `${v.trip.consumption.toFixed(1)} L/100km`], ['range', v.range === null ? '--' : `${Math.round(v.range * k)} ${imperial ? 'mi' : 'km'}`]];
      rows.forEach(([key, value], i) => { const ry = y + 64 + i * 46; this.text(tr(lang, key), x, ry, 15, css(p.dim)); this.text(value, x + w, ry + 2, 24, css(p.ink), 'right', NUM, 700); c.fillStyle = css(p.line); c.fillRect(x, ry + 14, w, 1); });
    } else {
      if (!v.dtcs.length) { c.beginPath(); c.arc(x + w / 2, y + 108, 30, 0, TAU); c.lineWidth = 5; c.strokeStyle = this.color(GREEN); c.stroke(); c.beginPath(); c.moveTo(x + w / 2 - 13, y + 108); c.lineTo(x + w / 2 - 3, y + 119); c.lineTo(x + w / 2 + 15, y + 97); c.stroke(); this.text(tr(lang, 'no_dtc'), x + w / 2, y + 178, 14, css(p.dim), 'center'); }
      v.dtcs.slice(0, 4).forEach((dtc, i) => {
        const ry = y + 54 + i * 48, pair = dtc.active ? (dtc.level === 1 ? RED : AMBER) : [p.dim, p.dim];
        c.beginPath(); c.arc(x + 7, ry - 6, 5, 0, TAU); c.fillStyle = this.color(pair); c.fill();
        this.text(dtc.code, x + 20, ry, 20, css(p.ink), 'left', NUM, 700); this.text(`${tr(lang, dtc.active ? 'active' : 'stored')} ×${dtc.count}`, x + w, ry, 14, this.color(pair), 'right');
        this.text(this.fit(tr(lang, dtc.code), w, 13), x, ry + 20, 13, css(p.dim));
      });
    }
  }
  fit(value, width, size) { const c = this.ctx; c.font = `600 ${size}px ${TXT}`; if (c.measureText(value).width <= width) return value; while (value.length > 2 && c.measureText(value + '…').width > width) value = value.slice(0, -1); return value + '…'; }
  popup(alert) {
    const c = this.ctx, p = this.p, red = alert.level === 1, pair = red ? RED : AMBER, x = 300, y = 352, w = 660, h = 74, pulse = red && this.view.blink;
    c.save(); c.shadowColor = 'rgba(0,0,0,.45)'; c.shadowBlur = 30; c.shadowOffsetY = 8; this.round(x, y, w, h, 14); c.fillStyle = css(mix(p.panel, mix(pair[0], pair[1], this.t), pulse ? .2 : .06), .97); c.fill(); c.restore();
    this.round(x, y, w, h, 14); c.lineWidth = 3; c.strokeStyle = this.color(pair); c.stroke(); this.round(x, y, 10, h, [14, 0, 0, 14]); c.fillStyle = this.color(pair); c.fill();
    this.icon('master', x + 52, y + 38, this.color(pair), false);
    this.text(this.fit(tr(this.lang, alert.code), w - 250, 24), x + 92, y + 34, 24, css(p.ink), 'left', TXT, 700); this.text(`DTC ${alert.code}`, x + 92, y + 58, 15, css(p.dim), 'left', NUM, 600);
    this.round(x + w - 138, y + 20, 118, 34, 17); c.lineWidth = 1.5; c.strokeStyle = css(p.dim); c.stroke(); this.text(tr(this.lang, 'ok'), x + w - 79, y + 43, 14, css(p.ink), 'center');
  }
}
