// Ambient sound, synthesised in the browser with the Web Audio API — no audio files.
// Five slow oscillators through a low-pass filter, plus a short tick for interface feedback.
// Nothing is created until the user turns sound on.
export class Ambient {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  on = false;

  private init(): boolean {
    const Ctor: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return false;
    const ctx = new Ctor();
    const master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 650;
    filter.Q.value = 0.7;
    filter.connect(master);
    [55, 82.4, 110, 164.8, 220].forEach((frequency, i) => {
      const osc = ctx.createOscillator();
      osc.type = i % 2 ? 'sine' : 'triangle';
      osc.frequency.value = frequency;
      osc.detune.value = (Math.random() - 0.5) * 14;
      const gain = ctx.createGain();
      gain.gain.value = 0.07 / (i + 1);
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.05 + i * 0.025;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 0.035 / (i + 1);
      lfo.connect(lfoGain);
      lfoGain.connect(gain.gain);
      osc.connect(gain);
      gain.connect(filter);
      osc.start();
      lfo.start();
    });
    const sweep = ctx.createOscillator();
    sweep.frequency.value = 0.06;
    const sweepGain = ctx.createGain();
    sweepGain.gain.value = 320;
    sweep.connect(sweepGain);
    sweepGain.connect(filter.frequency);
    sweep.start();
    this.ctx = ctx;
    this.master = master;
    return true;
  }

  /** Must be called from a user gesture the first time. Returns the resulting state. */
  set(value: boolean): boolean {
    try {
      if (!this.ctx && (!value || !this.init())) {
        this.on = false;
        return false;
      }
      const ctx = this.ctx as AudioContext;
      const master = this.master as GainNode;
      void ctx.resume();
      const now = ctx.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(master.gain.value, now);
      master.gain.linearRampToValueAtTime(value ? 0.55 : 0, now + 1.4);
      this.on = value;
    } catch {
      this.on = false;
    }
    return this.on;
  }

  /** Short sine blip, 2600 Hz falling to 900 Hz. Silent unless sound is on. */
  tick(): void {
    if (!this.on || !this.ctx) return;
    try {
      const ctx = this.ctx;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const t = ctx.currentTime;
      osc.type = 'sine';
      osc.frequency.setValueAtTime(2600, t);
      osc.frequency.exponentialRampToValueAtTime(900, t + 0.04);
      gain.gain.setValueAtTime(0.05, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.07);
    } catch {
      /* audio is decoration: never let it break the page */
    }
  }

  dispose(): void {
    this.on = false;
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.master = null;
  }
}

const GLYPHS = 'ΑΒΓΔΣΩΨ#%&*+<>/\\|01·';
const timers = new WeakMap<HTMLElement, ReturnType<typeof setInterval>>();

/** Scrambles an element's text and resolves it left to right. */
export function decode(el: HTMLElement): void {
  const final = el.dataset.text ?? el.textContent ?? '';
  el.dataset.text = final;
  const running = timers.get(el);
  if (running) clearInterval(running);
  let frame = 0;
  const total = 34;
  const id = setInterval(() => {
    const cut = (frame / total) * final.length;
    let out = '';
    for (let i = 0; i < final.length; i++) {
      out += final[i] === ' ' || i < cut ? final[i] : GLYPHS[(Math.random() * GLYPHS.length) | 0];
    }
    el.textContent = out;
    if (++frame > total) {
      clearInterval(id);
      timers.delete(el);
      el.textContent = final;
    }
  }, 32);
  timers.set(el, id);
}

export function stopDecode(el: HTMLElement): void {
  const running = timers.get(el);
  if (running) clearInterval(running);
  timers.delete(el);
  if (el.dataset.text) el.textContent = el.dataset.text;
}
