import { parseDBC, hex, unpackSignal } from './core/can.mjs';
import { Session, STEP, ENVIRONMENTS, BENCH } from './core/session.mjs';
import { FAULTS } from './core/ecu.mjs';
import { ClusterRenderer } from './hmi/cluster.mjs';
import { tr } from './hmi/i18n.mjs';
import { RideWorld } from './world/scene.mjs';
import { RideAudio } from './audio.mjs';

const $ = id => document.getElementById(id);
const text = (id, value) => { if ($(id).textContent !== String(value)) $(id).textContent = value; };
const timeText = value => Number.isFinite(value) && value > 0 ? `${Math.floor(value / 60)}:${(value % 60).toFixed(2).padStart(5, '0')}` : '—';
let noticeTimer;
function notify(value) { text('notice', value); $('notice').classList.add('visible'); clearTimeout(noticeTimer); noticeTimer = setTimeout(() => $('notice').classList.remove('visible'), 3500); }

try {
  const response = await fetch('./core/vehicle.dbc'); if (!response.ok) throw new Error('DBC 加载失败');
  const session = new Session(parseDBC(await response.text())), messages = session.messages;
  const cluster = new ClusterRenderer($('cluster')), audio = new RideAudio();
  const world = new RideWorld($('world'), session.track, $('cluster')); world.setEntries(session.race.entries);
  world.setQuality(innerWidth < 600 ? 'low' : innerWidth < 1000 ? 'medium' : 'high'); $('quality').value = world.quality;
  const keys = new Set(), touches = new Map(), signalRows = new Map();
  let accumulator = 0, lastTime = performance.now(), hudTime = 0, frameMs = 16.7, slowTime = 0, finished = false, bootAt = null;
  let activeTab = 'bench', tracePaused = false, traceSnapshot = [], gamepadButtons = [], framePeak = 0;
  const cameraNames = { chase: '追尾视角', cockpit: '座舱视角', cluster: '仪表特写', cinema: '电影视角' };
  const map = session.track.minimap(), xs = map.map(p => p[0]), zs = map.map(p => p[1]);
  const minX = Math.min(...xs), minZ = Math.min(...zs), scale = Math.min(145 / (Math.max(...xs) - minX), 115 / (Math.max(...zs) - minZ));
  const mapPoint = f => [12 + (f.x - minX) * scale, 12 + (f.z - minZ) * scale];
  $('map-track').setAttribute('d', map.map(([x, z], i) => `${i ? 'L' : 'M'}${mapPoint({ x, z }).join(',')}`).join(' ') + 'Z');
  text('track-length', `${(session.track.length / 1000).toFixed(2)} KM`);

  function release() { keys.clear(); touches.clear(); document.querySelectorAll('[data-touch]').forEach(b => b.classList.remove('held')); }
  function start(mode) {
    release(); session.start(mode); world.setEntries(session.race.entries); world.setEnvironment(session.environment);
    finished = false; bootAt = null; accumulator = 0; traceSnapshot = []; tracePaused = false;
    $('trace-pause').setAttribute('aria-pressed', 'false'); text('trace-pause', '暂停 Trace');
    $('finish-card').hidden = true; $('pause').setAttribute('aria-pressed', 'false'); text('pause', '暂停');
    document.querySelectorAll('[data-fault]').forEach(el => el.checked = false);
    for (const [key, value] of Object.entries(BENCH)) {
      const el = document.querySelector(`[data-bench="${key}"]`);
      if (el) { el.value = key === 'light' ? ENVIRONMENTS[session.environment].light : value; el.nextElementSibling.value = el.value; }
    }
    if (mode === 'bench') openEngineering('bench'); else $('engineering').hidden = true;
    updateHUD();
  }
  function takeOver() { if (!session.auto || session.mode === 'bench' || session.race.state === 'finished') return; session.takeOver(); updateHUD(); }
  function togglePause() { session.paused = !session.paused; release(); audio.silence(); text('pause', session.paused ? '继续' : '暂停'); $('pause').setAttribute('aria-pressed', String(session.paused)); updateHUD(); }
  function camera() { if (session.mode === 'demo') session.mode = 'practice'; const modes = Object.keys(cameraNames); world.cameraMode = modes[(modes.indexOf(world.cameraMode) + 1) % modes.length]; world.started = false; text('camera', cameraNames[world.cameraMode]); }
  function openEngineering(tab = activeTab) {
    $('engineering').hidden = false; activeTab = tab;
    document.querySelectorAll('[data-panel]').forEach(el => el.hidden = el.dataset.panel !== tab);
    document.querySelectorAll('[data-tab]').forEach(el => el.classList.toggle('active', el.dataset.tab === tab)); updateEngineering();
  }
  document.querySelectorAll('[data-start]').forEach(el => el.onclick = () => start(el.dataset.start));
  $('again').onclick = () => start('race'); $('pause').onclick = togglePause; $('camera').onclick = camera;
  $('auto').onclick = () => { if (session.mode === 'bench') return; if (session.auto) session.takeOver(); else session.auto = true; updateHUD(); };
  $('guide-open').onclick = () => { release(); $('guide').showModal(); };
  $('settings-open').onclick = () => { release(); $('settings').showModal(); };
  document.querySelectorAll('[data-close]').forEach(el => el.onclick = () => el.closest('dialog').close());
  $('engineering-open').onclick = () => openEngineering(); $('engineering-close').onclick = () => $('engineering').hidden = true;
  document.querySelectorAll('[data-tab]').forEach(el => el.onclick = () => openEngineering(el.dataset.tab));
  $('environment').onchange = event => { session.setEnvironment(event.target.value); world.setEnvironment(session.environment); updateHUD(); };
  $('assist').onchange = event => { session.assist = event.target.value; notify('辅助已切换；专业模式需要手动控制压弯与刹车。'); };
  $('quality').onchange = event => { world.setQuality(event.target.value); slowTime = 0; };
  for (const [id, key] of [['language', 'lang'], ['units', 'units'], ['theme', 'theme']]) $(id).onchange = event => session.settings[key] = event.target.value;
  $('page').onclick = () => session.hmi.nextPage(); $('ack').onclick = () => session.hmi.acknowledge();
  $('ride-modes').onclick = event => { const mode = event.target.closest('[data-mode]')?.dataset.mode; if (mode) session.ecu.mode = mode; };
  $('cluster').onclick = () => session.hmi.acknowledge();
  $('sound').onclick = async () => { try { if (audio.enabled) audio.mute(); else await audio.enable(); $('sound').setAttribute('aria-pressed', String(audio.enabled)); text('sound', audio.enabled ? '声音 ON' : '声音 OFF'); } catch (error) { notify(error.message); } };
  $('fullscreen').onclick = async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); } catch { notify('当前浏览器不支持全屏。'); } };

  const sliderDefs = [['speed', '车速 km/h', 0, 300, 1], ['rpm', '转速 rpm', 0, 14000, 100], ['throttle', '油门 %', 0, 100, 1], ['lean', '倾角 °', -58, 58, 1], ['gear', '挡位', 0, 6, 1], ['coolant', '水温 °C', 40, 130, 1], ['fuel', '燃油 %', 0, 100, 1], ['front', '前胎压 bar', .5, 3.5, .02], ['rear', '后胎压 bar', .5, 3.5, .02], ['light', '光照 lx', 0, 70000, 100]];
  for (const [key, label, min, max, step] of sliderDefs) {
    const row = document.createElement('label'), name = document.createElement('span'), input = document.createElement('input'), output = document.createElement('output');
    name.textContent = label; input.type = 'range'; input.min = min; input.max = max; input.step = step; input.value = BENCH[key]; input.dataset.bench = key; input.setAttribute('aria-label', label); output.value = input.value;
    input.oninput = () => { if (session.ecu.override) session.ecu.override[key] = +input.value; output.value = input.value; };
    row.append(name, input, output); $('bench-sliders').append(row);
  }
  for (const [key, fault] of Object.entries(FAULTS)) {
    const label = document.createElement('label'), input = document.createElement('input'); input.type = 'checkbox'; input.dataset.fault = key;
    input.onchange = () => session.setFault(key, input.checked); label.append(input, document.createTextNode(fault.zh)); $('faults').append(label);
  }
  $('faults-clear').onclick = () => { for (const name of Object.keys(FAULTS)) session.setFault(name, false); document.querySelectorAll('[data-fault]').forEach(el => el.checked = false); };
  $('ignition').onclick = () => { session.ecu.ignition = 0; bootAt = session.now + 500; };
  $('clear-dtcs').onclick = () => session.hmi.clearDTCs();
  $('trace-pause').onclick = () => { tracePaused = !tracePaused; if (tracePaused) traceSnapshot = [...session.bus.trace]; $('trace-pause').setAttribute('aria-pressed', String(tracePaused)); text('trace-pause', tracePaused ? '继续 Trace' : '暂停 Trace'); updateEngineering(); };
  for (const message of messages.values()) {
    const option = document.createElement('option'); option.value = message.id; option.textContent = `0x${message.id.toString(16).toUpperCase()} / ${message.name}`; $('trace-filter').append(option);
    for (const signal of message.payload) {
      const row = document.createElement('tr'); row.dataset.signal = signal.name;
      for (let i = 0; i < 4; i++) row.append(document.createElement('td'));
      row.children[0].textContent = signal.name; $('signals').append(row); signalRows.set(signal.name, { row, message, signal });
    }
  }
  $('trace-filter').onchange = updateEngineering;
  $('export').onclick = () => {
    const data = { network: 'APEX synthetic CAN', nowMs: session.now, environment: session.environment, mode: session.mode, stats: session.store.stats, dtcs: session.hmi.view.dtcs,
      signals: Object.fromEntries([...signalRows.keys()].map(name => [name, { value: session.store.read(name, session.now), quality: session.store.quality(name, session.now) }])),
      trace: session.bus.trace.map(f => ({ id: f.id, dlc: f.dlc, data: [...f.data], time: f.time, period: f.period, valid: f.ok })) };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })), a = document.createElement('a'); a.href = url; a.download = 'apex-diagnostics.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  document.querySelectorAll('[data-demo]').forEach(el => el.onclick = () => {
    $('guide').close(); const kind = el.dataset.demo;
    if (kind === 'boot') { start('bench'); session.ecu.ignition = 0; bootAt = session.now + 500; }
    if (kind === 'can' || kind === 'performance') openEngineering('trace');
    if (kind === 'crc') { start('bench'); session.setFault('crc_abs', true); document.querySelector('[data-fault="crc_abs"]').checked = true; openEngineering('trace'); }
    if (kind === 'alerts') { start('bench'); session.ecu.override.coolant = 124; session.setFault('oil', true); session.hmi.settings.page = 4; const slider = document.querySelector('[data-bench="coolant"]'); slider.value = 124; slider.dispatchEvent(new Event('input')); document.querySelector('[data-fault="oil"]').checked = true; }
    if (kind === 'locale') { start('bench'); session.hmi.settings.page = 1; $('settings').showModal(); }
  });
  function updateEngineering() {
    if ($('engineering').hidden) return;
    const { bus, store, hmi, now } = session;
    text('engineering-metrics', `${bus.rate} frames/s · ${bus.load.toFixed(1)}% @ 500 kbit/s · RX ${store.stats.received} · CRC ${store.stats.crcErrors} · Counter ${store.stats.counterErrors} | TFT ${cluster.drawMs.toFixed(2)} ms · Frame ${frameMs.toFixed(1)} ms · Peak ${framePeak.toFixed(1)} ms`);
    if (activeTab === 'bench') document.querySelectorAll('[data-bench]').forEach(el => el.disabled = session.mode !== 'bench');
    if (activeTab === 'trace') {
      const filter = $('trace-filter').value, frames = (tracePaused ? traceSnapshot : bus.trace).filter(f => !filter || f.id === +filter).slice(-28).reverse();
      $('trace-body').replaceChildren(...frames.map(f => {
        const row = document.createElement('tr'), message = messages.get(f.id), counter = message.counter ? unpackSignal(f.data, message.counter) : '-';
        for (const value of [`${f.id.toString(16).toUpperCase()} / ${f.dlc}`, hex(f.data), `${counter} / ${f.ok ? 'OK' : 'BAD'}`, `${f.period.toFixed(2)} / ${(f.period - message.cycle).toFixed(2)}`]) { const cell = document.createElement('td'); cell.textContent = value; if (!f.ok) cell.className = 'bad'; row.append(cell); } return row;
      }));
      text('periods', [...messages.values()].map(m => { const s = bus.state.get(m.id); return `${m.name}: ${s.count ? s.period.toFixed(2) : '—'}/${m.cycle} ms`; }).join(' · '));
    }
    if (activeTab === 'signals') for (const [name, { row, message, signal }] of signalRows) {
      const value = store.read(name, now), age = now - store.frames.get(message.id).time;
      row.children[1].textContent = value === null ? '---' : `${Number(value.toFixed(2))} ${signal.unit}`;
      row.children[2].textContent = store.quality(name, now); row.children[2].className = value === null ? 'bad' : '';
      row.children[3].textContent = Number.isFinite(age) ? Math.round(age) : '—';
    }
    if (activeTab === 'dtc') $('dtcs').replaceChildren(...(hmi.view.dtcs.length ? hmi.view.dtcs.map(d => { const el = document.createElement('p'); el.className = d.active ? 'active' : ''; el.textContent = `${d.code} · ${tr(session.settings.lang, d.code)} · ${d.active ? '当前' : '历史'} ×${d.count}`; return el; }) : [Object.assign(document.createElement('p'), { textContent: '系统正常 · 无故障码' })]));
  }
  function updateHUD() {
    const v = session.hmi.view, race = session.race, mode = session.mode;
    document.body.dataset.ready = 'true'; document.body.dataset.state = session.paused ? 'paused' : race.state; document.body.dataset.mode = mode;
    text('session-title', mode === 'demo' ? '让每一次骑行，清晰可见。' : mode === 'bench' ? '把每个状态，握在手中。' : mode === 'race' ? '八位骑手，两圈较量。' : '找到属于你的入弯节奏。');
    text('session-hint', session.paused ? '已暂停 · P 继续' : mode === 'demo' ? '自动演示中 · 按任意键或触摸画面接管' : mode === 'bench' ? 'HMI 实验台 · 调节信号，观察仪表响应' : session.auto ? '自动驾驶中 · W / S / A / D 接管' : 'W / S 油门与刹车 · A / D 转向 · C 切换视角');
    text('position', v.lap.valid ? `P${v.lap.position} / ${v.lap.entrants}` : '—'); text('lap', v.lap.valid ? `${v.lap.number} / ${v.lap.total || '∞'}` : '—'); text('lap-time', v.lap.valid ? timeText(v.lap.time) : '—');
    if (v.nav.valid) { const f = session.track.frame(v.nav.position * session.track.length), [x, y] = mapPoint(f); $('map-dot').setAttribute('cx', x); $('map-dot').setAttribute('cy', y); } $('map-dot').style.display = v.nav.valid ? '' : 'none';
    for (let i = 0; i < 3; i++) $('sector-colors').children[i].className = v.lap.sectors?.[i]?.status ?? '';
    $('start-lights').classList.toggle('idle', race.state !== 'countdown'); [...$('start-lights').children].forEach((el, i) => el.classList.toggle('lit', race.lights > i));
    text('auto', `自动驾驶 ${session.auto ? 'ON' : 'OFF'}`); $('auto').setAttribute('aria-pressed', String(session.auto));
    text('cluster-status', `${v.power.toUpperCase()} / ${v.busDead ? 'BUS OFF' : v.night ? 'NIGHT' : 'DAY'} · ${v.mode}`);
    text('cluster-accessible', `${v.speed.valid ? Math.round(v.speed.value) + ' km/h' : '车速信号丢失'}，挡位 ${v.gear ?? '丢失'}，${v.popup ? tr(session.settings.lang, v.popup.code) : '无未确认告警'}`);
    document.querySelectorAll('[data-mode]').forEach(el => el.setAttribute('aria-pressed', String(el.dataset.mode === v.mode)));
    document.querySelectorAll('.session-nav [data-start]').forEach(el => el.setAttribute('aria-pressed', String(el.dataset.start === mode)));
    text('performance', `${(1000 / Math.max(1, frameMs)).toFixed(0)} FPS · TFT ${cluster.drawMs.toFixed(2)} ms · ${world.quality.toUpperCase()}`); updateEngineering();
  }
  addEventListener('keydown', event => {
    if (event.ctrlKey || event.altKey || event.metaKey || event.target.matches('input,select,textarea') || $('settings').open || $('guide').open) return;
    const key = event.key.toLowerCase(); if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ', 'tab'].includes(key)) event.preventDefault();
    if (session.mode === 'demo') takeOver(); keys.add(key); if (event.repeat) return;
    if (key === 'p') togglePause(); if (key === 'r') start(session.mode === 'demo' ? 'practice' : session.mode); if (key === 'c') camera();
    if (key === 'enter') session.hmi.acknowledge(); if (key === 'tab') session.hmi.nextPage();
    if (key === 'q') session.ecu.left = !session.ecu.left; if (key === 'e') session.ecu.right = !session.ecu.right; if (key === 'l') session.ecu.highBeam = !session.ecu.highBeam;
    if (['w', 's', 'a', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) takeOver();
  });
  addEventListener('keyup', event => keys.delete(event.key.toLowerCase())); addEventListener('blur', release);
  document.addEventListener('visibilitychange', () => { if (document.hidden) { release(); audio.silence(); } lastTime = performance.now(); accumulator = 0; });
  $('world').onpointerdown = () => takeOver();
  for (const button of document.querySelectorAll('[data-touch]')) {
    button.onpointerdown = event => { event.preventDefault(); button.setPointerCapture(event.pointerId); touches.set(event.pointerId, button.dataset.touch); button.classList.add('held'); takeOver(); };
    button.onlostpointercapture = button.onpointerup = button.onpointercancel = event => { touches.delete(event.pointerId); button.classList.remove('held'); };
  }
  function input() {
    const has = (...values) => values.some(v => keys.has(v) || [...touches.values()].includes(v));
    const state = { throttle: +has('w', 'arrowup', 'throttle'), brake: +has('s', 'arrowdown', 'brake'), steer: +has('d', 'arrowright', 'right') - +has('a', 'arrowleft', 'left') };
    const pad = navigator.getGamepads?.()[0];
    if (pad && !$('settings').open && !$('guide').open) {
      const axis = Math.abs(pad.axes[0]) > .12 ? pad.axes[0] : 0, throttle = pad.buttons[7]?.value ?? 0, brake = pad.buttons[6]?.value ?? 0;
      if (axis || throttle > .05 || brake > .05) { takeOver(); state.steer = axis; state.throttle = throttle; state.brake = brake; }
      for (const [index, action] of [[0, () => session.hmi.acknowledge()], [3, camera], [9, togglePause]]) if (pad.buttons[index]?.pressed && !gamepadButtons[index]) action();
      gamepadButtons = pad.buttons.map(b => b.pressed);
    }
    return state;
  }
  function step(state) {
    if (bootAt !== null && session.now >= bootAt) { session.ecu.ignition = 2; bootAt = null; }
    session.step(state);
    for (const event of session.events) {
      if (event.type === 'jumpstart') notify('抢跑：成绩加罚 5 秒。');
      if (event.type === 'crash' && event.entry.player) { audio.ping('collision'); notify('车辆摔倒，赛道救援即将复位。'); }
      if (event.type === 'upshift' || event.type === 'downshift') audio.cut?.(); if (event.type === 'sector') audio.ping();
    }
    if (session.race.state === 'finished' && !finished) {
      finished = true; const p = session.race.player; text('result', `P${p.position} · 最快 ${timeText(p.best)} · 总成绩 ${timeText(p.finishTime + (p.penalty ?? 0))} · 摔车 ${p.crashes} 次`);
      $('classification').replaceChildren(...session.race.order.map(e => Object.assign(document.createElement('li'), { textContent: `${e.name} · ${e.finished ? timeText(e.finishTime + (e.penalty ?? 0)) : '+' + e.gap.toFixed(0) + ' m'}` })));
      $('finish-card').hidden = false; release(); audio.ping();
    }
  }
  let lastAlert = '';
  function render(stamp) {
    const elapsed = Math.min(.1, Math.max(0, (stamp - lastTime) / 1000)); lastTime = stamp;
    frameMs += (elapsed * 1000 - frameMs) * .04; framePeak = Math.max(framePeak, elapsed * 1000);
    if (!document.hidden) {
      accumulator = Math.min(accumulator + elapsed, STEP * 12); const state = input();
      while (accumulator >= STEP) { step(state); accumulator -= STEP; }
      cluster.draw(session.hmi.view); world.update(session.poses(session.paused ? 1 : accumulator / STEP), session, elapsed, stamp / 1000);
      const v = session.hmi.view; audio.update(v.rpm.valid ? v.rpm.value : 0, v.speed.valid ? v.speed.value : 0, v.throttle / 100, !session.paused && v.power === 'run', v.abs.active || v.tcs.active);
      if (v.popup?.code && v.popup.code !== lastAlert) audio.ping('warning'); lastAlert = v.popup?.code ?? '';
      slowTime = 1000 / Math.max(1, frameMs) < (world.quality === 'low' ? 30 : 50) ? slowTime + elapsed : 0;
      if (slowTime > 3 && world.quality !== 'low') { world.setQuality(world.quality === 'high' ? 'medium' : 'low'); $('quality').value = world.quality; slowTime = 0; notify('已根据帧率自动降低画质。'); }
      if (stamp - hudTime > 150) { updateHUD(); hudTime = stamp; }
    }
    requestAnimationFrame(render);
  }
  if (new URLSearchParams(location.search).has('test')) globalThis.__hmi = { session, world, cluster, start, updateHUD,
    advance(seconds, state = {}) { for (let i = 0; i < Math.round(seconds / STEP); i++) step(state); cluster.draw(session.hmi.view); updateHUD(); return { state: session.race.state, laps: session.race.player.laps, crashes: session.crashes, outside: session.outside }; } };
  updateHUD(); requestAnimationFrame(render);
} catch (error) { console.error(error); document.body.dataset.ready = 'error'; notify(`无法启动：${error.message}`); text('session-hint', '请确认浏览器支持 WebGL 2，并通过本地服务器打开项目。'); }
