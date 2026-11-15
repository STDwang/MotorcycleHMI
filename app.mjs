import { parseDBC, encodeFrame, SignalStore, AlertManager, modes } from './model.mjs';
import { RideSession } from './ride.mjs';
import { RideWorld } from './world.mjs';
import { RideAudio } from './audio.mjs';

const $ = id => document.getElementById(id);
const text = (id, value) => { const el = $(id); if (el.textContent !== String(value)) el.textContent = value; };
const format = (value, digits = 0) => value === null ? '—' : value.toFixed(digits);
const timer = seconds => `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toFixed(1).padStart(4, '0')}`;
let toastTimer;
function notify(message, duration = 3300) {
  text('notice', message); $('notice').classList.add('visible'); clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('notice').classList.remove('visible'), duration);
}

try {
  const response = await fetch('./vehicle.dbc'); if (!response.ok) throw new Error('DBC 加载失败');
  const dbcText = await response.text(), messages = parseDBC(dbcText);
  const world = new RideWorld($('world'));
  const ride = new RideSession(world.length), vehicle = ride.vehicle, audio = new RideAudio();
  let store = new SignalStore(messages), alertManager = new AlertManager();
  let now = 0, accumulator = 0, received = 0, activeAlerts = [], lastAlert = '', usedCruise = false;
  let lastTime = performance.now(), lastUI = -1000, fpsTime = lastTime, frameCount = 0, elapsed = 0;
  let previousEvent = '', previousCollisions = 0, previousCheckpoint = 0, shownFinish = false, best = null;
  let reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const keys = new Set(), touches = new Map(), rows = new Map(), frameElements = new Map();
  try { const value = Number(localStorage.getItem('apex.best.alpine.v2')); if (value > 0 && Number.isFinite(value)) best = value; } catch { /* Storage is optional. */ }
  $('track-length').textContent = `${(world.length / 1000).toFixed(2)} km`;
  if (innerWidth < 900) world.setQuality(true);
  for (let i = 0; i < 32; i++) { const bar = document.createElement('i'); if (i > 25) bar.className = 'red'; $('rpm-bars').append(bar); }
  const bars = [...$('rpm-bars').children];
  const labels = {
    Speed: ['车速', 'km/h'], RPM: ['发动机转速', 'rpm'], Gear: ['挡位', ''], Temperature: ['冷却液温度', '°C'], Fuel: ['燃油', '%'],
    FrontPressure: ['前胎压', 'bar'], RearPressure: ['后胎压', 'bar'], Mode: ['骑行模式', ''], LeftIndicator: ['左转向灯', ''],
    RightIndicator: ['右转向灯', ''], HighBeam: ['远光灯', ''], ABSFault: ['ABS 故障位', ''],
  };
  for (const message of messages.values()) {
    const frame = document.createElement('div'); frame.className = 'frame';
    frame.innerHTML = `<div class="frame-head"><b>0x${message.id.toString(16).toUpperCase()}</b><span>${message.name}</span><small>— ms</small></div><div class="frame-bytes">—</div>`;
    $('frames').append(frame); frameElements.set(message.id, frame);
    for (const signal of message.signals) {
      const row = document.createElement('div'); row.className = 'signal'; row.dataset.signal = signal.name;
      const label = document.createElement('span'); label.className = 'signal-name'; label.textContent = labels[signal.name]?.[0] || signal.name;
      const detail = document.createElement('small'); detail.textContent = `${signal.name} · ${signal.start}|${signal.length}`; label.append(detail);
      const value = document.createElement('span'); value.className = 'signal-value';
      row.append(label, value); $('signals').append(row); rows.set(signal.name, { value, signal });
    }
  }
  const mapPoints = world.samples.filter((_, i) => i % 4 === 0).map(p => ({ x: 75 + p.x * .12, y: 65 + p.z * .12 }));
  const mapPath = mapPoints.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ') + ' Z';
  $('track-map').setAttribute('d', mapPath); $('map-progress').setAttribute('d', mapPath);
  const mapLength = $('map-progress').getTotalLength();
  $('map-progress').style.strokeDasharray = `${mapLength} ${mapLength}`;

  function transmit() {
    if (vehicle.scenario === 'offline') return;
    const values = vehicle.values();
    for (const message of messages.values()) if (store.receive(encodeFrame(message, values), now)) received++;
  }
  function metric(id, value, unit = '') {
    const el = $(id), key = String(value) + unit; if (el.dataset.value === key) return;
    el.dataset.value = key; el.replaceChildren(document.createTextNode(value));
    if (unit) { const small = document.createElement('small'); small.textContent = unit; el.append(small); }
  }
  function controls() {
    $('cruise').setAttribute('aria-pressed', String(vehicle.auto)); text('cruise', `巡航 ${vehicle.auto ? 'ON' : 'OFF'}`);
    text('pause', ride.state === 'paused' ? '继续' : '暂停'); $('pause').disabled = !['running', 'paused'].includes(ride.state);
    document.querySelectorAll('[data-mode]').forEach(button => button.setAttribute('aria-pressed', String(+button.dataset.mode === vehicle.mode)));
    document.querySelectorAll('[data-scenario]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.scenario === vehicle.scenario)));
    for (const [id, value] of [['left', vehicle.left], ['right', vehicle.right], ['beam', vehicle.highBeam]]) $(id).setAttribute('aria-pressed', String(value));
    document.body.classList.toggle('paused', ride.state === 'paused');
    document.body.dataset.state = ride.state;
  }
  function renderHUD() {
    const get = name => store.read(name, now);
    const speed = get('Speed'), rpm = get('RPM'), gear = get('Gear'), mode = get('Mode');
    text('speed', format(speed)); document.querySelector('.speed-wrap').classList.toggle('triple', speed !== null && speed >= 100);
    text('rpm', rpm === null ? '—' : (rpm / 1000).toFixed(1));
    text('gear', gear === null ? '—' : gear === 0 ? 'N' : gear); text('mode-badge', mode === null ? '—' : modes[mode]);
    bars.forEach((bar, i) => bar.classList.toggle('on', rpm !== null && i < rpm / 14000 * bars.length));
    $('rpm-bars').setAttribute('aria-valuenow', rpm ?? 0); $('rpm-bars').setAttribute('aria-valuetext', rpm === null ? '信号失效' : `${rpm} rpm`);
    const blink = reducedMotion || Math.floor(now / 450) % 2 === 0;
    $('left-lamp').classList.toggle('lit', get('LeftIndicator') === 1 && blink);
    $('right-lamp').classList.toggle('lit', get('RightIndicator') === 1 && blink);
    $('beam-lamp').classList.toggle('lit', get('HighBeam') === 1); $('abs-lamp').classList.toggle('lit', get('ABSFault') === 1);
    metric('fuel', format(get('Fuel')), '%'); metric('temperature', format(get('Temperature')), '°C');
    text('front-pressure', format(get('FrontPressure'), 2)); text('rear-pressure', format(get('RearPressure'), 2));
    $('front-pressure').style.color = get('FrontPressure') !== null && get('FrontPressure') < 1.9 ? 'var(--amber)' : '';
    $('temperature').style.color = get('Temperature') !== null && get('Temperature') >= 110 ? 'var(--red)' : '';
    text('temp-state', get('Temperature') === null ? 'SIGNAL LOST' : get('Temperature') >= 110 ? 'OVERHEAT' : 'NORMAL');
    $('fuel-fill').style.width = `${get('Fuel') ?? 0}%`;
    const healthy = ['Speed', 'FrontPressure', 'Mode'].every(name => get(name) !== null);
    text('bus-state', healthy ? 'ONLINE' : 'SIGNAL LOST'); $('bus-state').classList.toggle('lost', !healthy); $('bus-dot').style.background = healthy ? '' : 'var(--red)';
    const signature = JSON.stringify(activeAlerts.map(a => [a.key, a.acknowledged]));
    if (signature !== lastAlert) {
      lastAlert = signature; const top = activeAlerts[0];
      $('alert').className = `alert${top ? top.priority === 3 ? ' critical' : ' warning' : ''}`;
      text('alert-symbol', top ? '!' : '✓'); text('alert-title', top ? `${top.title}${top.acknowledged ? ' · 已确认' : ''}` : '车辆状态正常');
      text('alert-detail', top ? top.detail : '信号有效，专注前方的路。');
    }
    $('acknowledge').disabled = !activeAlerts.some(a => !a.acknowledged);
    text('mode-hint', speed === null ? '信号失效' : speed <= 5 ? '≤5 km/h 可切换' : '减速至 ≤5 km/h');
    text('timer', timer(ride.time + ride.penalty));
    $('checkpoint').innerHTML = `${ride.checkpoint} <em>/ 4</em>`;
    $('remaining').innerHTML = `${Math.max(0, (world.length - ride.distance) / 1000).toFixed(2)} <em>km</em>`;
    text('sector', `SECTOR 0${Math.min(4, ride.checkpoint + 1)}`);
    text('ride-state', { ready: 'READY TO RIDE', running: vehicle.auto ? 'AUTO CRUISE' : ride.offroad ? 'OFF ROAD' : 'ON THE ROAD', paused: 'PAUSED', finished: 'LOOP COMPLETED' }[ride.state]);
    $('progress').style.width = `${ride.distance / world.length * 100}%`;
    $('map-progress').style.strokeDashoffset = String(mapLength * (1 - ride.distance / world.length));
    const p = world.frame(ride.distance + 8).point; $('map-position').setAttribute('cx', 75 + p.x * .12); $('map-position').setAttribute('cy', 65 + p.z * .12);
    $('next-checkpoint').innerHTML = `0${Math.min(4, ride.checkpoint + 1)} <small>/ 04</small>`;
    text('penalties', `碰撞 ${ride.collisions} · 罚时 +${ride.penalty}s`);
    world.updateBikeDisplay(speed, gear === null ? null : gear === 0 ? 'N' : gear);
    for (const [name, { value, signal }] of rows) {
      const reading = get(name), quality = store.quality(name, now);
      value.className = `signal-value${quality === 'valid' ? '' : ' invalid'}`;
      value.title = { valid: '有效', stale: '超过 600 ms 未更新', invalid: '物理值越界', missing: '未收到' }[quality];
      let display = format(reading, signal.factor < 1 ? 2 : 0);
      if (name === 'Mode' && reading !== null) display = modes[reading];
      if (name === 'Gear' && reading === 0) display = 'N';
      value.replaceChildren(document.createTextNode(display));
      const unit = document.createElement('small'); unit.textContent = labels[name]?.[1] || '';
      const dot = document.createElement('i'); value.append(unit, dot); value.dataset.quality = quality;
    }
    for (const [id, el] of frameElements) {
      const frame = store.frames.get(id), age = frame ? Math.round(now - frame.time) : null;
      el.querySelector('small').textContent = `${age === null ? '—' : age} ms`;
      el.querySelector('.frame-bytes').textContent = frame ? [...frame.data].map(value => value.toString(16).toUpperCase().padStart(2, '0')).join(' ') : '—';
      el.classList.toggle('stale', age === null || age > 600);
    }
    text('rx', received); text('rejected', store.rejected);
    document.body.dataset.distance = ride.distance.toFixed(2); document.body.dataset.lateral = ride.lateral.toFixed(2);
    controls();
  }
  function applyInput() {
    if (ride.state !== 'running') return;
    const input = new Set([...keys, ...touches.values()]);
    const throttle = input.has('w') || input.has('arrowup') || input.has('throttle');
    const brake = input.has('s') || input.has('arrowdown') || input.has('brake');
    if (throttle || brake) vehicle.auto = false;
    if (!vehicle.auto) { vehicle.throttle = throttle ? .95 : 0; vehicle.brake = brake ? 1 : 0; }
    ride.steering = +(input.has('d') || input.has('arrowright') || input.has('right')) - +(input.has('a') || input.has('arrowleft') || input.has('left'));
  }
  function releaseInputs() {
    keys.clear(); touches.clear(); vehicle.throttle = 0; vehicle.brake = 0; ride.steering = 0;
    document.querySelectorAll('.touch-controls .held').forEach(button => button.classList.remove('held'));
  }
  function start(auto = false) {
    if (ride.state === 'finished') reset();
    ride.start(); vehicle.auto = auto; if (auto) usedCruise = true;
    $('start-card').hidden = true; $('finish-card').hidden = true; controls();
    notify(auto ? '自动巡航中。按 W / S 接管，A / D 转向。' : 'W 加速 · S 刹车 · A / D 转向。沿公路穿过四个检查点。');
  }
  function reset() {
    releaseInputs(); ride.reset(); store = new SignalStore(messages); alertManager = new AlertManager();
    now = 0; accumulator = 0; received = 0; usedCruise = false; previousEvent = ''; previousCollisions = 0; previousCheckpoint = 0; shownFinish = false;
    $('start-card').hidden = false; $('finish-card').hidden = true; transmit(); activeAlerts = alertManager.update(store, now);
    renderHUD(); audio.silence(); notify('已重置，准备新的一圈。');
  }
  function pause() {
    if (ride.state === 'running') { ride.pause(); releaseInputs(); audio.silence(); notify('已暂停。按 P 或点击继续恢复。'); }
    else if (ride.state === 'paused') { ride.start(); notify('继续骑行。'); }
    controls();
  }
  function finish() {
    shownFinish = true; releaseInputs(); audio.silence(); audio.ping();
    const total = ride.time + ride.penalty;
    if (!usedCruise && (best === null || total < best)) {
      best = total; try { localStorage.setItem('apex.best.alpine.v2', String(best)); } catch { /* Optional persistence. */ }
    }
    text('result-time', timer(total)); text('result-detail', `骑行 ${timer(ride.time)} · 碰撞 ${ride.collisions} 次 · 罚时 +${ride.penalty}s`);
    text('best-time', usedCruise ? '本圈使用过巡航，不计入手动最佳成绩。' : `本机手动最佳 ${timer(best)}`);
    $('finish-card').hidden = false;
  }
  $('start').addEventListener('click', () => start(false)); $('start-auto').addEventListener('click', () => start(true));
  $('pause').addEventListener('click', pause); $('reset').addEventListener('click', reset); $('again').addEventListener('click', () => { reset(); start(false); });
  $('cruise').addEventListener('click', () => {
    if (ride.state === 'ready' || ride.state === 'finished') start(true);
    else { vehicle.auto = !vehicle.auto; if (vehicle.auto) usedCruise = true; if (ride.state === 'paused') ride.start(); notify(vehicle.auto ? '自动巡航已接管。' : '已切回手动驾驶。'); controls(); }
  });
  $('modes').addEventListener('click', event => {
    const button = event.target.closest('[data-mode]'); if (!button) return;
    if (store.read('Speed', now) === null) { notify('CAN 信号失效，暂不能确认模式切换。'); return; }
    notify(vehicle.setMode(+button.dataset.mode) ? `已切换 ${modes[vehicle.mode]} 模式。` : '模式切换被拦截：请先减速至 5 km/h 以下。'); controls();
  });
  for (const [id, property] of [['left', 'left'], ['right', 'right'], ['beam', 'highBeam']]) $(id).addEventListener('click', () => {
    vehicle[property] = !vehicle[property];
    if (property === 'left' && vehicle.left) vehicle.right = false;
    if (property === 'right' && vehicle.right) vehicle.left = false; controls();
  });
  $('scenarios').addEventListener('click', event => {
    const button = event.target.closest('[data-scenario]'); if (!button) return;
    vehicle.scenario = button.dataset.scenario;
    notify(vehicle.scenario === 'offline' ? 'CAN 已中断。600 ms 后仪表信号失效；车辆仍可驾驶。' : vehicle.scenario === 'normal' ? '已恢复正常信号。' : '故障从 ECU 注入，观察左侧报文与右侧告警。'); controls();
  });
  $('acknowledge').addEventListener('click', () => { alertManager.acknowledge(); notify('已确认，提示将持续到故障恢复。'); });
  $('sound').addEventListener('click', async () => {
    try {
      if (audio.enabled) audio.mute(); else await audio.enable();
      $('sound').setAttribute('aria-pressed', String(audio.enabled)); $('sound').querySelector('span').textContent = audio.enabled ? 'ON' : 'OFF';
      notify(audio.enabled ? '合成音效已开启：发动机 / 风噪 / 碰撞提示。' : '已静音。');
    } catch (error) { notify(error.message); }
  });
  $('quality').addEventListener('click', () => {
    const low = world.quality !== 'low'; world.setQuality(low); $('quality').setAttribute('aria-pressed', String(low)); $('quality').querySelector('span').textContent = low ? '流畅' : '高';
    notify(low ? '流畅画质：降低渲染分辨率与远处树木数量。' : '高画质已开启。');
  });
  $('fullscreen').addEventListener('click', async () => {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }
    catch { notify('此浏览器无法进入全屏。'); }
  });
  $('help').addEventListener('click', () => {
    if (ride.state === 'running') { ride.pause(); releaseInputs(); audio.silence(); controls(); }
    $('about').showModal(); $('help').setAttribute('aria-expanded', 'true');
  });
  $('close-help').addEventListener('click', () => $('about').close());
  $('about').addEventListener('close', () => $('help').setAttribute('aria-expanded', 'false'));
  $('about').addEventListener('click', event => { if (event.target === $('about')) { const rect = $('about').getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) $('about').close(); } });
  for (const [id, className] of [['telemetry-toggle', 'show-can'], ['dashboard-toggle', 'show-dashboard']]) $(id).addEventListener('click', () => {
    const open = document.body.classList.toggle(className); $(id).setAttribute('aria-expanded', String(open));
    const other = className === 'show-can' ? 'show-dashboard' : 'show-can'; document.body.classList.remove(other);
    $(id === 'telemetry-toggle' ? 'dashboard-toggle' : 'telemetry-toggle').setAttribute('aria-expanded', 'false');
  });
  $('telemetry-toggle').setAttribute('aria-controls', 'signals');
  $('dashboard-toggle').setAttribute('aria-controls', 'dashboard-panel'); document.querySelector('.dashboard').id = 'dashboard-panel';
  $('export').addEventListener('click', () => {
    const data = { project: 'APEX / procedural 3D / synthetic CAN', timestamp: new Date().toISOString(), dbc: dbcText,
      session: { state: ride.state, distance: ride.distance, lateral: ride.lateral, time: ride.time, penalty: ride.penalty, collisions: ride.collisions, usedCruise },
      signals: Object.fromEntries([...rows.keys()].map(name => [name, { value: store.read(name, now), quality: store.quality(name, now) }])),
      frames: [...store.frames.values()].map(frame => ({ id: frame.id, data: [...frame.data], ageMs: now - frame.time })), alerts: activeAlerts, receivedFrames: received };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'apex-ride-diagnostics.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  $('portfolio').href = 'https://stdwang.github.io/penpenWeb/';
  $('portfolio').title = '返回个人作品集';
  const drivingKeys = ['w', 's', 'a', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'];
  addEventListener('keydown', event => {
    if (event.ctrlKey || event.metaKey || event.altKey || $('about').open || event.target instanceof HTMLElement && (event.target.matches('input,textarea,select') || event.target.isContentEditable)) return;
    const key = event.key.toLowerCase();
    if (drivingKeys.includes(key)) {
      event.preventDefault(); if (ride.state === 'ready') start(false); keys.add(key); return;
    }
    if (event.repeat) return;
    if (key === 'p') { event.preventDefault(); pause(); }
    if (key === 'r') { event.preventDefault(); reset(); }
    if (key === 'q') $('left').click(); if (key === 'e') $('right').click(); if (key === 'l') $('beam').click();
  });
  addEventListener('keyup', event => keys.delete(event.key.toLowerCase()));
  document.querySelectorAll('[data-touch]').forEach(button => {
    button.addEventListener('pointerdown', event => {
      event.preventDefault(); if (ride.state === 'ready') start(false);
      button.setPointerCapture(event.pointerId); touches.set(event.pointerId, button.dataset.touch); button.classList.add('held');
    });
    const release = event => { touches.delete(event.pointerId); if (![...touches.values()].includes(button.dataset.touch)) button.classList.remove('held'); };
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(name, release);
  });
  const suspend = () => { releaseInputs(); if (ride.state === 'running') { ride.pause(); controls(); } audio.silence(); };
  addEventListener('blur', suspend);
  document.addEventListener('visibilitychange', () => { if (document.hidden) suspend(); lastTime = performance.now(); fpsTime = lastTime; frameCount = 0; });
  addEventListener('world-context-lost', () => { suspend(); notify('图形上下文已丢失，请刷新页面恢复 3D 场景。', 20000); });
  matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', event => { reducedMotion = event.matches; });
  transmit(); activeAlerts = alertManager.update(store, now); renderHUD();
  world.update(ride, 0, .016, reducedMotion); document.body.dataset.ready = 'true';
  notify('山湖环线已生成。点击开始，或按 W 出发。');
  function tick(timestamp) {
    const dt = Math.min(.1, Math.max(0, (timestamp - lastTime) / 1000)); lastTime = timestamp;
    if (!document.hidden) {
      elapsed += dt; now += dt * 1000; accumulator += dt; applyInput();
      while (accumulator >= .05) { ride.step(.05); transmit(); accumulator -= .05; }
      activeAlerts = alertManager.update(store, now);
      if (ride.lastEvent !== previousEvent) {
        previousEvent = ride.lastEvent;
        if (ride.lastEvent) notify(ride.lastEvent);
      }
      if (ride.collisions > previousCollisions) {
        previousCollisions = ride.collisions; audio.ping('collision'); document.querySelector('.vignette').classList.add('collision-flash');
        setTimeout(() => document.querySelector('.vignette').classList.remove('collision-flash'), 250);
      }
      if (ride.checkpoint > previousCheckpoint) { previousCheckpoint = ride.checkpoint; audio.ping(); }
      if (ride.state === 'finished' && !shownFinish) finish();
      audio.update(vehicle.values().RPM, vehicle.speed, vehicle.throttle, ride.state === 'running');
      world.update(ride, elapsed, dt, reducedMotion);
      if (timestamp - lastUI >= 100) { renderHUD(); lastUI = timestamp; }
      frameCount++;
      if (timestamp - fpsTime >= 1000) { text('fps', Math.round(frameCount * 1000 / (timestamp - fpsTime))); frameCount = 0; fpsTime = timestamp; }
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
} catch (error) {
  console.error(error); document.body.dataset.ready = 'error';
  const panel = document.createElement('div'); panel.className = 'startup-error';
  panel.textContent = `3D 场景启动失败：${error.message}。请使用支持 WebGL2 的浏览器，确认硬件加速已开启，并通过 HTTP 服务访问。`;
  document.body.append(panel); $('start-card').hidden = true; text('bus-state', 'ERROR');
}
