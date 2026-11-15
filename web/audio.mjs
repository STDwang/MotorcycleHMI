// Entire soundscape is synthesized; no samples, downloads or media files.
export class RideAudio {
  constructor() { this.context = null; this.enabled = false; }
  async enable() {
    const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Context) throw new Error('浏览器不支持 Web Audio');
    if (!this.context) {
      const ctx = this.context = new Context();
      this.master = ctx.createGain(); this.master.gain.value = .22;
      const compressor = ctx.createDynamicsCompressor(); compressor.threshold.value = -20;
      this.master.connect(compressor); compressor.connect(ctx.destination);
      this.engineGain = ctx.createGain(); this.engineGain.gain.value = 0;
      const filter = this.engineFilter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 650;
      filter.connect(this.engineGain); this.engineGain.connect(this.master);
      this.oscillators = [1, 2.01, .5].map((ratio, i) => {
        const oscillator = ctx.createOscillator(), gain = ctx.createGain();
        oscillator.type = i === 1 ? 'triangle' : 'sawtooth'; gain.gain.value = [.45, .25, .25][i];
        oscillator.connect(gain); gain.connect(filter); oscillator.start();
        return { oscillator, ratio };
      });
      const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const samples = buffer.getChannelData(0);
      let seed = 2718;
      for (let i = 0; i < samples.length; i++) { seed = (seed * 1664525 + 1013904223) >>> 0; samples[i] = seed / 2147483648 - 1; }
      const noise = ctx.createBufferSource(); noise.buffer = buffer; noise.loop = true;
      this.windFilter = ctx.createBiquadFilter(); this.windFilter.type = 'bandpass'; this.windFilter.frequency.value = 1000; this.windFilter.Q.value = .45;
      this.windGain = ctx.createGain(); this.windGain.gain.value = 0;
      noise.connect(this.windFilter); this.windFilter.connect(this.windGain); this.windGain.connect(this.master); noise.start();
    }
    await this.context.resume(); this.enabled = true;
  }
  mute() { this.enabled = false; this.silence(); }
  silence() {
    if (!this.context) return;
    const time = this.context.currentTime;
    this.engineGain.gain.setTargetAtTime(0, time, .05); this.windGain.gain.setTargetAtTime(0, time, .05);
  }
  update(rpm, speed, throttle, running) {
    if (!this.context || !this.enabled || !running) { this.silence(); return; }
    const time = this.context.currentTime;
    const frequency = Math.max(32, rpm / 60 * 1.35);
    for (const { oscillator, ratio } of this.oscillators) oscillator.frequency.setTargetAtTime(frequency * ratio, time, .07);
    this.engineFilter.frequency.setTargetAtTime(350 + rpm * .15 + throttle * 900, time, .08);
    this.engineGain.gain.setTargetAtTime(.1 + throttle * .16, time, .08);
    this.windGain.gain.setTargetAtTime(Math.min(.3, speed / 420), time, .14);
    this.windFilter.frequency.setTargetAtTime(400 + speed * 12, time, .1);
  }
  ping(kind = 'checkpoint') {
    if (!this.context || !this.enabled) return;
    const ctx = this.context, time = ctx.currentTime;
    const oscillator = ctx.createOscillator(), gain = ctx.createGain();
    oscillator.type = kind === 'collision' ? 'triangle' : 'sine';
    oscillator.frequency.setValueAtTime(kind === 'collision' ? 100 : 660, time);
    oscillator.frequency.exponentialRampToValueAtTime(kind === 'collision' ? 38 : 990, time + .18);
    gain.gain.setValueAtTime(.18, time); gain.gain.exponentialRampToValueAtTime(.001, time + .35);
    oscillator.connect(gain); gain.connect(this.master); oscillator.start(time); oscillator.stop(time + .36);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  }
}
