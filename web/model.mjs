// Deliberately restricted DBC subset: standard IDs, Intel unsigned signals.
// Unsupported syntax is rejected rather than decoded with guessed semantics.
export function parseDBC(text) {
  const messages = new Map();
  let current;
  for (const source of text.split(/\r?\n/)) {
    const line = source.trim();
    if (line.startsWith('BO_ ')) {
      const match = /^BO_ (\d+) (\w+): (\d+) \w+$/.exec(line);
      if (!match) throw new Error(`不支持的消息定义: ${line}`);
      const [, id, name, dlc] = match;
      if (+id > 0x7ff || +dlc < 1 || +dlc > 8 || messages.has(+id)) throw new Error('无效或重复的标准帧');
      current = { id: +id, name, dlc: +dlc, signals: [] };
      messages.set(current.id, current);
    } else if (line.startsWith('SG_ ')) {
      const match = /^SG_ (\w+) : (\d+)\|(\d+)@1\+ \(([-\d.]+),([-\d.]+)\) \[([-\d.]+)\|([-\d.]+)\] "([^"]*)" \w+$/.exec(line);
      if (!current || !match) throw new Error(`仅支持无符号 Intel 非复用信号: ${line}`);
      const [, name, start, length, factor, offset, min, max, unit] = match;
      const signal = { name, start: +start, length: +length, factor: +factor, offset: +offset, min: +min, max: +max, unit };
      if (signal.length < 1 || signal.length > 32 || signal.start + signal.length > current.dlc * 8 || signal.factor <= 0 || signal.min > signal.max) throw new Error('无效的信号范围');
      if ([...messages.values()].some(m => m.signals.some(s => s.name === name))) throw new Error('重复信号名');
      if (current.signals.some(s => signal.start < s.start + s.length && s.start < signal.start + signal.length)) throw new Error('信号位重叠');
      current.signals.push(signal);
    }
  }
  if (!messages.size) throw new Error('没有消息定义');
  return messages;
}

export function encodeFrame(message, values) {
  const data = new Uint8Array(message.dlc);
  for (const s of message.signals) {
    const value = values[s.name];
    if (!Number.isFinite(value) || value < s.min || value > s.max) throw new Error(`${s.name} 超出范围`);
    const raw = Math.round((value - s.offset) / s.factor);
    if (raw < 0 || raw >= 2 ** s.length) throw new Error(`${s.name} 超出位宽`);
    for (let bit = 0; bit < s.length; bit++) {
      if (Math.floor(raw / 2 ** bit) % 2) data[Math.floor((s.start + bit) / 8)] |= 1 << ((s.start + bit) % 8);
    }
  }
  return { id: message.id, data };
}

export function decodeFrame(message, data) {
  if (!(data instanceof Uint8Array) || data.length !== message.dlc) throw new Error('DLC 与消息定义不符');
  const result = {};
  for (const s of message.signals) {
    let raw = 0;
    for (let bit = 0; bit < s.length; bit++) raw += ((data[Math.floor((s.start + bit) / 8)] >> ((s.start + bit) % 8)) & 1) * 2 ** bit;
    const value = raw * s.factor + s.offset;
    result[s.name] = { value, valid: value >= s.min && value <= s.max, unit: s.unit };
  }
  return result;
}

export class SignalStore {
  constructor(messages, timeout = 600) {
    this.messages = messages;
    this.timeout = timeout;
    this.signals = new Map();
    this.frames = new Map();
    this.rejected = 0;
  }
  receive(frame, now) {
    const message = this.messages.get(frame.id);
    if (!message) { this.rejected++; return false; }
    try {
      const decoded = decodeFrame(message, frame.data);
      for (const [name, item] of Object.entries(decoded)) this.signals.set(name, { ...item, time: now });
      this.frames.set(frame.id, { ...frame, time: now });
      return true;
    } catch { this.rejected++; return false; }
  }
  read(name, now) {
    const item = this.signals.get(name);
    return item && item.valid && now - item.time <= this.timeout ? item.value : null;
  }
  quality(name, now) {
    const item = this.signals.get(name);
    if (!item) return 'missing';
    if (now - item.time > this.timeout) return 'stale';
    return item.valid ? 'valid' : 'invalid';
  }
}

export class AlertManager {
  constructor() { this.entries = new Map(); }
  update(store, now) {
    const get = name => store.read(name, now);
    const pressure = [get('FrontPressure'), get('RearPressure')];
    const temp = get('Temperature'), fuel = get('Fuel');
    const active = key => this.entries.get(key)?.active;
    const definitions = [
      ['communication', 3, 'CAN 通信中断', '动力 / 胎压 / 车控帧超过 600 ms 未更新，数值已失效', ['Speed', 'FrontPressure', 'Mode'].some(n => get(n) === null)],
      ['temperature', 3, '发动机温度过高', '请安全停车，检查冷却系统', temp !== null && temp >= (active('temperature') ? 105 : 110)],
      ['pressure', 2, '胎压偏低', '请安全停车检查轮胎', pressure.some(v => v !== null && v < (active('pressure') ? 2.1 : 1.9))],
      ['abs', 2, 'ABS 系统故障', '防抱死功能可能不可用，请检查车辆', get('ABSFault') === 1],
      ['fuel', 1, '燃油余量低', '请规划加油，续航为模拟估算', fuel !== null && fuel <= (active('fuel') ? 15 : 12)],
    ];
    for (const [key, priority, title, detail, isActive] of definitions) {
      let entry = this.entries.get(key);
      if (isActive && !entry?.active) {
        entry = { key, priority, title, detail, active: true, acknowledged: false, time: now };
        this.entries.set(key, entry);
      } else if (entry) entry.active = isActive;
    }
    return this.list();
  }
  acknowledge() { for (const e of this.entries.values()) if (e.active) e.acknowledged = true; }
  list() { return [...this.entries.values()].filter(e => e.active).sort((a, b) => b.priority - a.priority || a.time - b.time); }
}

export const modes = ['ROAD', 'SPORT', 'RAIN'];
export class VehicleSimulator {
  constructor() { this.reset(); }
  reset() {
    this.speed = 0; this.throttle = 0; this.brake = 0; this.auto = true;
    this.mode = 0; this.gear = 0; this.highBeam = false; this.left = false; this.right = false;
    this.scenario = 'normal'; this.distance = 0; this.elapsed = 0;
  }
  setMode(mode) {
    if (!Number.isInteger(mode) || mode < 0 || mode > 2) return false;
    // Demo interlock, not a manufacturer specification.
    if (this.speed > 5) return false;
    this.mode = mode; return true;
  }
  step(dt) {
    this.elapsed += dt;
    if (this.auto) {
      const target = [68, 105, 46][this.mode] + Math.sin(this.elapsed / 6) * 12;
      this.throttle = this.speed < target ? 0.55 : 0;
      this.brake = this.speed > target + 3 ? 0.12 : 0;
    }
    this.speed = Math.max(0, Math.min(220, this.speed + (this.throttle * [18, 26, 11][this.mode] - this.brake * 36 - 1.2 - this.speed * 0.018) * dt));
    this.distance += this.speed / 3600 * dt;
    this.gear = this.speed < 1 ? 0 : Math.min(6, Math.floor(this.speed / 26) + 1);
    return this.values();
  }
  values() {
    const rpm = this.speed < 1 ? 1200 : Math.min(12500, 1800 + this.speed / Math.max(1, this.gear) * 165);
    return {
      Speed: this.speed, RPM: rpm, Gear: this.gear,
      Temperature: this.scenario === 'overheat' ? 118 : 82 + Math.min(18, this.elapsed / 30),
      Fuel: this.scenario === 'fuel' ? 8 : Math.max(16, 78 - this.distance * 0.3),
      FrontPressure: this.scenario === 'tire' ? 1.65 : 2.35,
      RearPressure: 2.60, Mode: this.mode, LeftIndicator: +this.left,
      RightIndicator: +this.right, HighBeam: +this.highBeam, ABSFault: +(this.scenario === 'abs'),
    };
  }
}
