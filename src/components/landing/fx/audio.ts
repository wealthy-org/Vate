// Ambient music for the landing page: the VATE theme, a piece written for this site that the
// browser plays live with the Web Audio API. There is no audio file, no sample and no recording;
// every sound is an oscillator built in this file. The notes come from fx/score.ts, and this
// file is the instrument:
//
//   pads   three oscillators per note, a fraction of a hertz apart, swelling in and out slowly
//   halo   E, G and C, always present, each drifting louder and softer at its own pace
//   bells  sine partials with a soft attack and a long decay, an echo, and the VATE motif
//   room   a reverb whose impulse response is computed when the sound is first turned on
//
// Nothing is created until the user turns sound on, and the music pauses while the tab is hidden.
import { BAR, BELLS, HALO, TICKS, bellsAt, hz, newWalk, padsAt, rng } from './score';

/** Mix levels. Set by measuring an offline render of the piece, not by ear. */
const MIX = { voice: 0.085, bass: 0.066, halo: 0.082, bell: 0.12, tick: 0.12, wet: 0.6, out: 0.4 };
/** Seconds a pad note takes to arrive. */
const SWELL = 3.2;
/**
 * How a pad note leaves: [seconds before its last bar ends at which it starts to fade, seconds
 * after it at which it is gone]. Chords dovetail instead of smearing into each other, because two
 * low notes a step apart beat against each other while both sound. A note that is clear of the
 * next chord (score.ts decides) lingers instead and carries one chord into the next.
 */
const DOVETAIL = [2, 1.8];
const LINGER = [1, 4];
/**
 * The room is the same on every visit and at every sample rate: it is built at 48 kHz from this
 * seed. Of the ten seeds tried, this one keeps left and right most even under this piece's chords.
 */
const ROOM_SEED = 5;
const ROOM_RATE = 48000;
/** How far ahead of the audio clock notes are queued, in seconds. */
const AHEAD = 3;
/** Events during which a browser lets audio start. */
const GESTURES = ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown'] as const;

export interface Engine {
  /** Everything the engine plays leaves through this node. */
  out: GainNode;
  /** Queues every bar that starts before `until` (context time, in seconds). */
  schedule(until: number): void;
  /** A short tuned blip for interface feedback. */
  tick(): void;
}

/**
 * A synthetic room: noise that dies away (60 dB in 3.3 s) and darkens as it goes. Left and right
 * differ, which makes it wide. It is cut off after 2.4 s, 44 dB down, where the music covers it:
 * every further second of room costs processor time for as long as the sound is on.
 */
function impulse(ctx: BaseAudioContext): AudioBuffer {
  const rnd = rng(ROOM_SEED);
  const length = Math.floor(ROOM_RATE * 2.4);
  const gap = Math.floor(ROOM_RATE * 0.022); // silence before the first reflections
  const rise = ROOM_RATE * 0.015;
  const fall = ROOM_RATE * 0.25;
  const decay = Math.exp(-2.1 / ROOM_RATE); // per sample
  const step = ROOM_RATE / ctx.sampleRate;
  const buffer = ctx.createBuffer(2, Math.floor((length - 1) / step), ctx.sampleRate);
  for (let channel = 0; channel < 2; channel += 1) {
    const room = new Float32Array(length);
    const body = length - gap;
    let low = 0;
    let level = 1;
    let open = 0;
    let energy = 0;
    for (let n = 0; n < body; n += 1) {
      // A one-pole low-pass on the noise: it starts at 9 kHz and closes by a factor of six every three seconds.
      if (n % 64 === 0) open = 1 - Math.exp((-2 * Math.PI * 9000 * (1 / 6) ** (n / ROOM_RATE / 3)) / ROOM_RATE);
      low += (rnd() * 2 - 1 - low) * open;
      const value = low * level * Math.min(1, n / rise, (body - n) / fall);
      room[gap + n] = value;
      energy += value * value;
      level *= decay;
    }
    // Scaled to unit energy, so the room gives back about as much as it is sent and MIX.wet alone
    // sets its level; then resampled to the context's rate (a plain copy at 48 kHz). A rate with
    // twice the samples needs each of them at half the size to sound the same.
    const scale = step / Math.sqrt(energy);
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < data.length; i += 1) {
      const at = i * step;
      const k = Math.floor(at);
      data[i] = (room[k] + (room[k + 1] - room[k]) * (at - k)) * scale;
    }
  }
  return buffer;
}

/** Builds the instrument on any audio context (a live one, or an offline one for rendering to a buffer). */
export function createEngine(ctx: BaseAudioContext, seed: number): Engine {
  const rnd = rng(seed);
  const gain = (value: number): GainNode => {
    const node = ctx.createGain();
    node.gain.value = value;
    return node;
  };
  const filter = (type: BiquadFilterType, frequency: number, q: number): BiquadFilterNode => {
    const node = ctx.createBiquadFilter();
    node.type = type;
    node.frequency.value = frequency;
    node.Q.value = q;
    return node;
  };
  const place = (pan: number): AudioNode => {
    if (typeof ctx.createStereoPanner !== 'function') return gain(1);
    const node = ctx.createStereoPanner();
    node.pan.value = pan;
    return node;
  };
  const lfo = (rate: number, depth: number, target: AudioParam): void => {
    const osc = ctx.createOscillator();
    osc.frequency.value = rate;
    const amount = gain(depth);
    osc.connect(amount);
    amount.connect(target);
    osc.start();
  };

  const out = gain(MIX.out);

  // Room. Lows are kept out of the reverb so it stays clear; its tail is darkened.
  const send = filter('highpass', 220, 0.5);
  const room = ctx.createConvolver();
  room.normalize = false; // the impulse is already scaled; this must be set before the buffer
  room.buffer = impulse(ctx);
  const tail = filter('lowpass', 4200, 0.5);
  const wet = gain(MIX.wet);
  send.connect(room);
  room.connect(tail);
  tail.connect(wet);
  wet.connect(out);

  // Pads and halo share a low-pass that opens and closes over about 37 s. Only the pads feed the
  // room: on a tone that never stops, a reverb adds no space, it just makes it louder on one side.
  const pads = gain(1);
  const halo = gain(1);
  const warm = filter('lowpass', 1150, 0.4);
  const padSend = gain(0.6);
  pads.connect(warm);
  halo.connect(warm);
  warm.connect(out);
  pads.connect(padSend);
  padSend.connect(send);
  lfo(0.027, 450, warm.frequency);

  // Bells, with an echo that repeats a few times and loses its top each time round.
  const bells = gain(1);
  const bellSend = gain(0.9);
  const echoIn = gain(0.45);
  const echo = ctx.createDelay(1);
  echo.delayTime.value = 0.66;
  const damp = filter('lowpass', 1800, 0.5);
  const again = gain(0.36);
  const echoSend = gain(0.7);
  bells.connect(out);
  bells.connect(bellSend);
  bellSend.connect(send);
  bells.connect(echoIn);
  echoIn.connect(echo);
  echo.connect(damp);
  damp.connect(again);
  again.connect(echo);
  damp.connect(out);
  damp.connect(echoSend);
  echoSend.connect(send);

  /** One pad note: a centre oscillator and two quieter ones slightly below and above it, left and right. */
  const cluster = (note: number, target: AudioNode, start: number, stop: number | null): OscillatorNode[] => {
    const f = hz(note);
    const parts: [number, number, number, OscillatorType][] = [
      [0, 1, 0, 'triangle'],
      [-(0.18 + rnd() * 0.3), 0.24, -0.7, 'sine'],
      [0.18 + rnd() * 0.3, 0.24, 0.7, 'sine'],
    ];
    return parts.map(([offset, level, pan, type]) => {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = f + offset;
      const amount = gain(level);
      const where = place(pan);
      osc.connect(amount);
      amount.connect(where);
      where.connect(target);
      osc.start(start);
      if (stop !== null) osc.stop(stop);
      return osc;
    });
  };

  /** A gain that swells from silence, holds, and fades back to silence. Returns it with the time it is silent again. */
  const swell = (at: number, length: number, level: number, [leave, gone]: number[]): [GainNode, number] => {
    const env = gain(0);
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(level, at + SWELL);
    env.gain.setValueAtTime(level, at + length - leave);
    env.gain.linearRampToValueAtTime(0, at + length + gone);
    env.connect(pads);
    return [env, at + length + gone + 0.05];
  };

  const pad = (note: number, at: number, length: number, linger: boolean): void => {
    const [env, end] = swell(at, length, MIX.voice, linger ? LINGER : DOVETAIL);
    const oscs = cluster(note, env, at, end);
    oscs[0].onended = () => env.disconnect();
  };

  /** The bass: a sine, with a little triangle an octave up so small speakers still carry the note. */
  const bass = (note: number, at: number, length: number): void => {
    const [env, end] = swell(at, length, MIX.bass, DOVETAIL);
    const f = hz(note);
    const parts: [number, number, OscillatorType][] = [
      [f, 1, 'sine'],
      [f * 2, 0.45, 'triangle'],
    ];
    parts.forEach(([frequency, level, type], i) => {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = frequency;
      const amount = gain(level);
      osc.connect(amount);
      amount.connect(env);
      osc.start(at);
      osc.stop(end);
      if (i === 0) osc.onended = () => env.disconnect();
    });
  };

  // The halo never stops; each of its notes moves between a third of its level and all of it,
  // over 19, 27 and 34 seconds, so the three never line up the same way twice in a row.
  HALO.forEach((note, i) => {
    const level = MIX.halo * [1, 0.9, 0.6][i];
    const breath = gain(level * 0.67);
    lfo(1 / [19, 27, 34][i], level * 0.33, breath.gain);
    breath.connect(halo);
    cluster(note, breath, 0, null);
  });

  /** A bell: partials at 1×, 2× and 4× the pitch, the higher ones gone sooner. Motif notes add the octave below. */
  const bell = (note: number, at: number, level: number, pan: number, lead: boolean): void => {
    const f = hz(note);
    const ring = 5.2 * Math.sqrt(hz(BELLS[0]) / f); // seconds to fall by 60 dB; high notes are shorter
    const where = place(pan);
    where.connect(bells);
    const partials = [
      [1, 1, 1],
      [2, 0.25, 0.55],
      [4, 0.06, 0.25],
    ];
    if (lead) partials.push([0.5, 0.4, 1]);
    partials.forEach(([ratio, amount, life], i) => {
      const peak = MIX.bell * level * amount;
      const end = at + 0.012 + ring * life;
      const osc = ctx.createOscillator();
      osc.frequency.value = f * ratio;
      const env = gain(0);
      env.gain.setValueAtTime(0, at);
      env.gain.linearRampToValueAtTime(peak, at + 0.012);
      env.gain.exponentialRampToValueAtTime(peak / 1000, end);
      env.gain.linearRampToValueAtTime(0, end + 0.04);
      osc.connect(env);
      env.connect(where);
      osc.start(at);
      osc.stop(end + 0.06);
      if (i === 0) osc.onended = () => where.disconnect(); // the first partial rings the longest
    });
  };

  const walk = newWalk();
  let bar = 0;
  let next: number | null = null;
  const schedule = (until: number): void => {
    const now = ctx.currentTime;
    let fresh = false;
    // The first call, or the page was frozen for more than a bar: begin a bar now.
    if (next === null || next + BAR < now) {
      next = now + 0.08;
      fresh = true;
    }
    while (next < until) {
      const at = next;
      for (const p of padsAt(bar, fresh)) {
        if (p.bass) bass(p.note, at, p.bars * BAR);
        else pad(p.note, at, p.bars * BAR, p.linger);
      }
      // A bar queued late must not fire its missed bells all at once.
      for (const b of bellsAt(bar, rnd, walk)) if (at + b.at > now) bell(b.note, at + b.at, b.level, b.pan, b.lead);
      fresh = false;
      bar += 1;
      next += BAR;
    }
  };

  // Ticks answer the pointer, so they stay mostly dry: only a little of them reaches the room.
  const tickSend = gain(0.4);
  tickSend.connect(send);
  let ticks = 0;
  const tick = (): void => {
    const at = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.frequency.value = hz(TICKS[ticks % TICKS.length]);
    ticks += 1;
    const env = gain(0);
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(MIX.tick, at + 0.004);
    env.gain.exponentialRampToValueAtTime(MIX.tick / 1000, at + 0.18);
    env.gain.linearRampToValueAtTime(0, at + 0.2);
    osc.connect(env);
    env.connect(out);
    env.connect(tickSend);
    osc.start(at);
    osc.stop(at + 0.22);
    osc.onended = () => env.disconnect();
  };

  return { out, schedule, tick };
}

export class Ambient {
  on = false;
  private ctx: AudioContext | null = null;
  private engine: Engine | null = null;
  private master: GainNode | null = null;
  private pump: ReturnType<typeof setInterval> | null = null;
  private rest: ReturnType<typeof setTimeout> | null = null;

  private init(): boolean {
    const Ctor: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return false;
    // 'playback' asks for a larger buffer: this is background music, and it should not crackle
    // when the page is busy animating.
    const ctx = new Ctor({ latencyHint: 'playback' });
    try {
      const master = ctx.createGain();
      master.gain.value = 0;
      master.connect(ctx.destination);
      // A different seed every visit: the chords and the motif stay, the bells never repeat.
      const engine = createEngine(ctx, (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0);
      engine.out.connect(master);
      this.ctx = ctx;
      this.master = master;
      this.engine = engine;
    } catch {
      void ctx.close().catch(() => {});
      return false;
    }
    ctx.addEventListener('statechange', this.onState);
    document.addEventListener('visibilitychange', this.onVisibility);
    return true;
  }

  /**
   * Browsers start audio only during a user gesture, and not every event counts as one: a touch
   * counts when the finger lifts, not when it lands. While the music is meant to play and the
   * audio clock is not running, the next gesture asks again.
   */
  private unlock = (): void => {
    const { ctx } = this;
    if (!ctx || !this.on || ctx.state === 'running') return this.listen(false);
    if (document.visibilityState !== 'hidden') void ctx.resume().catch(() => {});
  };

  private listen(on: boolean): void {
    for (const type of GESTURES) {
      if (on) window.addEventListener(type, this.unlock, { capture: true, passive: true });
      else window.removeEventListener(type, this.unlock, { capture: true });
    }
  }

  /** The system can stop the clock too (a phone call, another app taking the output). */
  private onState = (): void => {
    if (this.on && this.ctx && this.ctx.state !== 'running' && document.visibilityState !== 'hidden') this.listen(true);
  };

  /** Fades in and keeps the queue of notes fed. */
  private play(): void {
    const { ctx, master, engine } = this;
    if (!ctx || !master || !engine) return;
    if (this.rest) clearTimeout(this.rest);
    this.rest = null;
    void ctx.resume().catch(() => {});
    if (ctx.state !== 'running') this.listen(true);
    const feed = (): void => {
      if (ctx.state === 'running') engine.schedule(ctx.currentTime + AHEAD);
    };
    feed();
    this.pump ??= setInterval(feed, 250);
    master.gain.setTargetAtTime(1, ctx.currentTime, 0.8);
  }

  /** Fades out, then stops the audio clock so the piece resumes where it left off. */
  private pause(seconds: number): void {
    const { ctx, master } = this;
    if (!ctx || !master) return;
    master.gain.setTargetAtTime(0, ctx.currentTime, seconds / 6);
    this.listen(false);
    if (this.rest) clearTimeout(this.rest);
    this.rest = setTimeout(() => {
      this.rest = null;
      if (this.pump) clearInterval(this.pump);
      this.pump = null;
      void ctx.suspend().catch(() => {});
    }, seconds * 1000);
  }

  private onVisibility = (): void => {
    if (!this.on) return;
    if (document.visibilityState === 'hidden') this.pause(0.5);
    else this.play();
  };

  /**
   * Call it from a user gesture: browsers start audio only then (if one refuses, the next gesture
   * tries again). Returns the resulting state.
   */
  set(value: boolean): boolean {
    try {
      if (!this.ctx && (!value || !this.init())) {
        this.on = false;
        return false;
      }
      this.on = value;
      if (value) this.play();
      else this.pause(1.8);
    } catch {
      this.on = false;
    }
    return this.on;
  }

  /** A short blip tuned to the piece. Silent unless sound is on. */
  tick(): void {
    if (!this.on || !this.engine || this.ctx?.state !== 'running') return;
    try {
      this.engine.tick();
    } catch {
      /* audio is decoration: never let it break the page */
    }
  }

  /** Called when the landing page goes away: a quick fade, then everything is released. */
  dispose(): void {
    const { ctx, master } = this;
    this.on = false;
    document.removeEventListener('visibilitychange', this.onVisibility);
    ctx?.removeEventListener('statechange', this.onState);
    this.listen(false);
    if (this.pump) clearInterval(this.pump);
    if (this.rest) clearTimeout(this.rest);
    this.pump = null;
    this.rest = null;
    this.ctx = null;
    this.master = null;
    this.engine = null;
    if (!ctx) return;
    const close = (): void => void ctx.close().catch(() => {});
    if (ctx.state !== 'running' || !master) return close();
    master.gain.setTargetAtTime(0, ctx.currentTime, 0.06);
    setTimeout(close, 400);
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
