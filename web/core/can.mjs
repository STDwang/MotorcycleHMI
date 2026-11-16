// CAN layer: DBC parsing, signal packing, E2E protection (rolling counter + CRC-8), a cyclic bus
// scheduler with a trace buffer, and the receive-side signal store with timeout supervision.

export function parseDBC(text) {
  const messages = new Map(); let current = null, baud = 500000;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim(); let m;
    if ((m = line.match(/^BS_:\s*(\d+)/))) baud = +m[1];
    else if ((m = line.match(/^BO_\s+(\d+)\s+(\w+)\s*:\s*(\d+)\s+(\w+)/))) {
      current = { id: +m[1], name: m[2], dlc: +m[3], sender: m[4], cycle: 100, comment: '', signals: [] };
      messages.set(current.id, current);
    } else if ((m = line.match(/^SG_\s+(\w+)\s*:\s*(\d+)\|(\d+)@([01])([+-])\s*\(([^,]+),([^)]+)\)\s*\[([^|]+)\|([^\]]+)\]\s*"([^"]*)"/)) && current) {
      current.signals.push({ name: m[1], start: +m[2], length: +m[3], littleEndian: m[4] === '1', signed: m[5] === '-', factor: +m[6], offset: +m[7], min: +m[8], max: +m[9], unit: m[10], message: current.name, values: null });
    } else if ((m = line.match(/^BA_\s+"GenMsgCycleTime"\s+BO_\s+(\d+)\s+(\d+)/))) { const message = messages.get(+m[1]); if (message) message.cycle = +m[2]; }
    else if ((m = line.match(/^CM_\s+BO_\s+(\d+)\s+"([^"]*)"/))) { const message = messages.get(+m[1]); if (message) message.comment = m[2]; }
    else if ((m = line.match(/^VAL_\s+(\d+)\s+(\w+)\s+(.*);$/))) {
      const signal = messages.get(+m[1])?.signals.find(s => s.name === m[2]);
      if (signal) signal.values = Object.fromEntries([...m[3].matchAll(/(\d+)\s+"([^"]*)"/g)].map(v => [+v[1], v[2]]));
    }
  }
  for (const message of messages.values()) {
    message.counter = message.signals.find(s => s.name.endsWith('_Counter')) || null;
    message.crc = message.signals.find(s => s.name.endsWith('_CRC')) || null;
    message.payload = message.signals.filter(s => s !== message.counter && s !== message.crc);
    message.timeout = Math.max(100, message.cycle * 5);
  }
  messages.baud = baud;
  return messages;
}

// Bit positions for a signal: Intel counts up from the LSB, Motorola walks down from the MSB (sawtooth).
function bitPositions(signal) {
  const bits = [];
  if (signal.littleEndian) for (let i = 0; i < signal.length; i++) bits.push(signal.start + i);
  else { let bit = signal.start; for (let i = 0; i < signal.length; i++) { bits.unshift(bit); bit = bit % 8 === 0 ? bit + 15 : bit - 1; } }
  return bits; // bits[0] is the least significant bit of the raw value
}
const positions = signal => signal.bits || (signal.bits = bitPositions(signal));

export function packSignal(data, signal, value) {
  const limit = 2 ** signal.length, low = signal.signed ? -limit / 2 : 0, high = signal.signed ? limit / 2 - 1 : limit - 1;
  let raw = Math.round((Math.min(signal.max, Math.max(signal.min, value)) - signal.offset) / signal.factor);
  raw = Math.min(high, Math.max(low, raw)); if (raw < 0) raw += limit;
  const bits = positions(signal);
  for (let i = 0; i < bits.length; i++) { const bit = bits[i], on = Math.floor(raw / 2 ** i) % 2; if (on) data[bit >> 3] |= 1 << (bit & 7); else data[bit >> 3] &= ~(1 << (bit & 7)); }
}
export function unpackSignal(data, signal) {
  const bits = positions(signal); let raw = 0;
  for (let i = 0; i < bits.length; i++) if (data[bits[i] >> 3] >> (bits[i] & 7) & 1) raw += 2 ** i;
  if (signal.signed && raw >= 2 ** (signal.length - 1)) raw -= 2 ** signal.length;
  return raw * signal.factor + signal.offset;
}

// CRC-8 SAE J1850 (poly 0x1D, init 0xFF, xor-out 0xFF) over payload bytes plus the low byte of the CAN ID.
const CRC_TABLE = Uint8Array.from({ length: 256 }, (_, n) => { let c = n; for (let i = 0; i < 8; i++) c = c & 0x80 ? (c << 1) ^ 0x1D : c << 1; return c & 0xFF; });
export function crc8(bytes, length, dataId = 0) {
  let crc = CRC_TABLE[0xFF ^ (dataId & 0xFF)];
  for (let i = 0; i < length; i++) crc = CRC_TABLE[crc ^ bytes[i]];
  return crc ^ 0xFF;
}

export function encodeFrame(message, values, counter = 0) {
  const data = new Uint8Array(message.dlc);
  for (const signal of message.payload) packSignal(data, signal, values[signal.name] ?? 0);
  if (message.counter) packSignal(data, message.counter, counter & 15);
  if (message.crc) data[message.dlc - 1] = crc8(data, message.dlc - 1, message.id);
  return { id: message.id, dlc: message.dlc, data };
}
export function decodeFrame(message, data) {
  const out = {};
  for (const signal of message.payload) out[signal.name] = unpackSignal(data, signal);
  return out;
}
export const hex = data => Array.from(data, b => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');

// Cyclic transmit scheduler. `source(message)` returns the current signal values or null when the node is silent.
export class CanBus {
  constructor(messages, traceSize = 240) {
    this.messages = messages; this.listeners = []; this.trace = []; this.traceSize = traceSize;
    this.state = new Map([...messages.values()].map((m, i) => [m.id, { next: i * 1.7, counter: 0, lastTx: -1, period: m.cycle, count: 0 }]));
    this.total = 0; this.bits = 0; this.window = []; this.load = 0; this.rate = 0; this.corrupt = new Set(); this.paused = false;
  }
  subscribe(listener) { this.listeners.push(listener); }
  advance(now, source) {
    for (const message of this.messages.values()) {
      const state = this.state.get(message.id); let burst = 0;
      while (now >= state.next && burst++ < 4) {
        state.next += message.cycle; if (now - state.next > message.cycle * 4) state.next = now + message.cycle;
        const values = source(message); if (!values) continue;
        const frame = encodeFrame(message, values, state.counter); state.counter = (state.counter + 1) & 15;
        if (this.corrupt.has(message.id)) frame.data[0] ^= 0x5A; // wire corruption after the sender computed its CRC
        frame.time = now; frame.name = message.name; frame.period = state.lastTx < 0 ? message.cycle : now - state.lastTx; state.lastTx = now; state.period = frame.period; state.count++;
        this.total++; const bits = 47 + 8 * frame.dlc + Math.floor((34 + 8 * frame.dlc - 1) / 4 * .5); this.window.push([now, bits]);
        for (const listener of this.listeners) frame.ok = listener(frame, now) !== false && frame.ok !== false;
        if (!this.paused) { this.trace.push(frame); if (this.trace.length > this.traceSize) this.trace.shift(); }
      }
    }
    while (this.window.length && now - this.window[0][0] > 1000) this.window.shift();
    this.rate = this.window.length; this.load = this.window.reduce((sum, item) => sum + item[1], 0) / this.messages.baud * 100;
  }
}

// Receive side: validates E2E, decodes, timestamps. The HMI reads values only through this store.
export class SignalStore {
  constructor(messages) {
    this.messages = messages; this.signals = new Map(); this.frames = new Map(); this.index = new Map();
    this.stats = { received: 0, crcErrors: 0, counterErrors: 0, unknown: 0 };
    for (const message of messages.values()) {
      this.frames.set(message.id, { time: -Infinity, counter: -1, count: 0, data: null, crcErrors: 0, counterErrors: 0 });
      for (const signal of message.payload) this.index.set(signal.name, { signal, message });
    }
  }
  receive(frame, now) {
    const message = this.messages.get(frame.id);
    if (!message) { this.stats.unknown++; return false; }
    const state = this.frames.get(frame.id);
    if (message.crc && frame.data[message.dlc - 1] !== crc8(frame.data, message.dlc - 1, message.id)) { this.stats.crcErrors++; state.crcErrors++; return false; }
    if (message.counter) {
      const counter = unpackSignal(frame.data, message.counter);
      if (state.counter >= 0 && counter === state.counter) { this.stats.counterErrors++; state.counterErrors++; return false; } // repeated frame
      if (state.counter >= 0 && now - state.time < message.timeout && ((counter - state.counter) & 15) > 3) { this.stats.counterErrors++; state.counterErrors++; }
      state.counter = counter;
    }
    const decoded = decodeFrame(message, frame.data);
    for (const name in decoded) this.signals.set(name, decoded[name]);
    state.time = now; state.count++; state.data = frame.data; this.stats.received++;
    return true;
  }
  // 'valid' | 'timeout' | 'missing'
  quality(name, now) {
    const entry = this.index.get(name); if (!entry) return 'missing';
    const state = this.frames.get(entry.message.id);
    return state.count === 0 ? 'missing' : now - state.time > entry.message.timeout ? 'timeout' : 'valid';
  }
  read(name, now) { return this.quality(name, now) === 'valid' ? this.signals.get(name) : null; }
  alive(messageName, now) {
    for (const message of this.messages.values()) if (message.name === messageName) { const state = this.frames.get(message.id); return state.count > 0 && now - state.time <= message.timeout; }
    return false;
  }
  label(name, value) { const values = this.index.get(name)?.signal.values; return values?.[value] ?? String(value); }
}
