import { describe, expect, it } from 'vitest';
import {
  BAR,
  BELLS,
  CLEAR,
  FORM,
  HALO,
  MOTIF,
  MOTIF_AT,
  TICKS,
  bellsAt,
  chordAt,
  hz,
  midi,
  newWalk,
  padsAt,
  rng,
  spell,
} from '@/components/landing/fx/score';

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const pitchClass = (note: number): string => NAMES[note % 12];
const C_MAJOR = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const PENTATONIC = ['C', 'D', 'E', 'G', 'A'];

/** Every bell of `bars` bars for one seed, with absolute times. */
function play(seed: number, bars: number) {
  const rnd = rng(seed);
  const walk = newWalk();
  return Array.from({ length: bars }, (_, bar) => bellsAt(bar, rnd, walk).map((b) => ({ ...b, bar, time: bar * BAR + b.at })));
}

describe('note helpers', () => {
  it('converts note names to MIDI numbers and frequencies', () => {
    expect(midi('A4')).toBe(69);
    expect(midi('C4')).toBe(60);
    expect(midi('F2')).toBe(41);
    expect(hz(69)).toBe(440);
    expect(hz(midi('A5'))).toBeCloseTo(880, 6);
    expect(hz(midi('C4'))).toBeCloseTo(261.626, 3);
    expect(() => midi('H2')).toThrow();
    expect(() => midi('C#4')).toThrow();
  });

  it('gives the same sequence for the same seed', () => {
    const a = rng(42);
    const b = rng(42);
    const c = rng(43);
    const first = [a(), a(), a(), a()];
    expect([b(), b(), b(), b()]).toEqual(first);
    expect([c(), c(), c(), c()]).not.toEqual(first);
    for (const value of first) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe('the VATE motif', () => {
  it('spells the name with the musical cryptogram', () => {
    expect(spell('VATE')).toEqual(['A', 'A', 'F', 'E']);
    // The rows of the cryptogram: every seventh letter shares a note.
    expect(spell('ABCDEFG')).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G']);
    expect(spell('HOV')).toEqual(['A', 'A', 'A']);
    expect(spell('vate')).toEqual(spell('VATE'));
    expect(spell('V-A T.E')).toEqual(spell('VATE'));
  });

  it('is A4, A5, F5, E5', () => {
    expect(MOTIF).toEqual([midi('A4'), midi('A5'), midi('F5'), midi('E5')]);
    expect(MOTIF.map(pitchClass)).toEqual(spell('VATE'));
    expect(MOTIF.map((note) => Math.round(hz(note) * 100) / 100)).toEqual([440, 880, 698.46, 659.26]);
  });

  it('is played in order at the start of every bar marked for it, and nowhere else', () => {
    for (const seed of [1, 2, 3]) {
      play(seed, FORM.length * 2).forEach((bells, bar) => {
        const lead = bells.filter((b) => b.lead);
        if (chordAt(bar).motif) {
          expect(lead.map((b) => b.note)).toEqual(MOTIF);
          expect(lead.map((b) => b.at)).toEqual(MOTIF_AT);
          // Nothing else sounds until the motif has had time to ring.
          const others = bells.filter((b) => !b.lead);
          for (const b of others) expect(b.at).toBeGreaterThanOrEqual(7.5);
        } else {
          expect(lead).toEqual([]);
        }
      });
    }
  });

  it('sounds over the F chord, where every one of its notes belongs', () => {
    const bars = FORM.map((c, i) => (c.motif ? i : -1)).filter((i) => i >= 0);
    expect(bars).toEqual([0, 4, 10, 12]);
    for (const bar of bars) {
      const c = chordAt(bar);
      expect(c.name).toBe('Fmaj9');
      const chordTones = [c.bass, ...c.voices, ...HALO].map(pitchClass);
      for (const note of MOTIF) expect(chordTones).toContain(pitchClass(note));
    }
  });
});

describe('the harmony', () => {
  it('has sixteen chords in the form A A B A', () => {
    expect(FORM.map((c) => c.name)).toEqual([
      'Fmaj9', 'C/E', 'Am7', 'G6/9',
      'Fmaj9', 'C/E', 'Am7', 'G6/9',
      'Dm11', 'Am7', 'Fmaj9', 'G6/9',
      'Fmaj9', 'C/E', 'Am7', 'G6/9',
    ]);
    expect(chordAt(16)).toBe(chordAt(0));
    expect(chordAt(-1)).toBe(FORM[15]);
    expect(chordAt(35)).toBe(FORM[3]);
  });

  it('stays in C major, with the bass under the inner notes and the halo above them', () => {
    for (const c of FORM) {
      for (const note of [c.bass, ...c.voices]) expect(C_MAJOR).toContain(pitchClass(note));
      expect(c.bass).toBeLessThan(Math.min(...c.voices));
      expect(Math.max(...c.voices)).toBeLessThan(Math.min(...HALO));
      expect([...c.voices].sort((a, b) => a - b)).toEqual(c.voices);
    }
    expect(HALO.map(pitchClass)).toEqual(['E', 'G', 'C']);
  });

  it('never puts a halo note a minor ninth above a chord note', () => {
    // A semitone (plus octaves) above a chord note is the one clash to avoid. The major seventh,
    // E over F in Fmaj9, is the opposite case and is wanted.
    for (const c of FORM) {
      for (const note of [c.bass, ...c.voices]) {
        for (const held of HALO) expect((((held - note) % 12) + 12) % 12).not.toBe(1);
      }
    }
    expect((((HALO[0] - FORM[0].bass) % 12) + 12) % 12).toBe(11);
  });

  it('keeps the notes inside a chord far enough apart not to beat', () => {
    for (const c of FORM) {
      const tones = [c.bass, ...c.voices, ...HALO].map(hz).sort((a, b) => a - b);
      for (let i = 1; i < tones.length; i += 1) expect(tones[i] - tones[i - 1]).toBeGreaterThanOrEqual(CLEAR);
    }
  });

  it('never repeats a bass note from one chord to the next', () => {
    FORM.forEach((c, bar) => expect(chordAt(bar + 1).bass).not.toBe(c.bass));
  });
});

describe('pad notes', () => {
  it('starts every note of the first bar, then only the notes that are new', () => {
    expect(padsAt(0, true).map((p) => p.note)).toEqual([midi('F2'), midi('C3'), midi('A3')]);
    // Bar 16 is the F chord again, but its A3 is still sounding from the G chord before it.
    expect(padsAt(16, false).map((p) => p.note)).toEqual([midi('F2'), midi('C3')]);
    expect(padsAt(1, false).map((p) => p.note)).toEqual([midi('E2'), midi('G3'), midi('C4')]);
  });

  it('holds a shared note through instead of striking it again', () => {
    const find = (bar: number, note: string) => padsAt(bar, false).find((p) => p.note === midi(note));
    expect(find(0, 'C3')?.bars).toBe(2); // F → C/E
    expect(find(1, 'C4')?.bars).toBe(2); // C/E → Am
    expect(find(2, 'C4')).toBeUndefined();
    expect(find(3, 'A3')?.bars).toBe(2); // G → F
    expect(find(8, 'C4')?.bars).toBe(2); // Dm → Am
    expect(find(10, 'A3')?.bars).toBe(3); // F → G → F
  });

  it('sounds exactly the notes of each chord in every bar', () => {
    const sounding = new Map<number, number>(); // note → last bar it covers
    for (let bar = 0; bar < FORM.length * 3; bar += 1) {
      for (const p of padsAt(bar, bar === 0)) {
        expect(sounding.get(p.note) ?? -1).toBeLessThan(bar); // never struck while still held
        sounding.set(p.note, bar + p.bars - 1);
      }
      const now = [...sounding].filter(([, last]) => last >= bar).map(([note]) => note).sort((a, b) => a - b);
      const c = chordAt(bar);
      expect(now).toEqual([c.bass, ...c.voices].sort((a, b) => a - b));
    }
  });

  it('hands at least one inner note from every chord to the next', () => {
    for (let bar = 0; bar < FORM.length; bar += 1) {
      const next = chordAt(bar + 1);
      const held = chordAt(bar).voices.some((note) => next.voices.includes(note));
      const lingering = [...Array(FORM.length).keys()].some((start) =>
        padsAt(start, false).some((p) => !p.bass && p.linger && (start + p.bars - 1) % FORM.length === bar),
      );
      expect(held || lingering).toBe(true);
    }
  });

  it('lets a note linger only when it is clear of everything in the next chord', () => {
    const lingering: string[] = [];
    for (let bar = 0; bar < FORM.length; bar += 1) {
      for (const p of padsAt(bar, false)) {
        const next = chordAt(bar + p.bars);
        const nearest = Math.min(...[next.bass, next.bass + 12, ...next.voices].map((other) => Math.abs(hz(other) - hz(p.note))));
        if (p.bass) expect(p.linger).toBe(false);
        else expect(p.linger).toBe(nearest >= CLEAR);
        if (p.linger) lingering.push(`${pitchClass(p.note)}→${next.name}`);
      }
    }
    expect([...new Set(lingering)].sort()).toEqual(['A→Dm11', 'C→Fmaj9', 'C→G6/9']);
  });
});

describe('bells', () => {
  it('is deterministic for a seed and different for another', () => {
    expect(play(7, 32)).toEqual(play(7, 32));
    expect(play(7, 32)).not.toEqual(play(8, 32));
  });

  it('uses only the pentatonic scale outside the motif', () => {
    expect(BELLS.map(pitchClass).every((name) => PENTATONIC.includes(name))).toBe(true);
    expect([...BELLS].sort((a, b) => a - b)).toEqual(BELLS);
    expect(TICKS.map(pitchClass).every((name) => PENTATONIC.includes(name))).toBe(true);
    for (const seed of [1, 2, 3, 4, 5]) {
      for (const b of play(seed, 200).flat()) {
        if (b.lead) continue;
        expect(BELLS).toContain(b.note);
      }
    }
  });

  it('keeps every bell inside its bar, in range, and in time order', () => {
    for (const seed of [11, 12, 13, 14, 15]) {
      for (const bells of play(seed, 200)) {
        const times = bells.map((b) => b.at);
        expect([...times].sort((a, b) => a - b)).toEqual(times);
        for (const b of bells) {
          expect(b.at).toBeGreaterThanOrEqual(0.6);
          expect(b.at).toBeLessThan(BAR);
          expect(b.level).toBeGreaterThan(0.35);
          expect(b.level).toBeLessThanOrEqual(1);
          expect(Math.abs(b.pan)).toBeLessThanOrEqual(0.6);
        }
      }
    }
  });

  it('moves by one or two scale steps', () => {
    for (const seed of [21, 22, 23]) {
      const line = play(seed, 300).flat().filter((b) => !b.lead).map((b) => BELLS.indexOf(b.note));
      for (let i = 1; i < line.length; i += 1) {
        const move = Math.abs(line[i] - line[i - 1]);
        expect(move).toBeGreaterThanOrEqual(0); // reflecting off either end can land on the same step
        expect(move).toBeLessThanOrEqual(2);
      }
      // The line really wanders: it reaches both ends of the scale.
      expect(Math.min(...line)).toBe(0);
      expect(Math.max(...line)).toBe(BELLS.length - 1);
    }
  });

  it('stays sparse, and never rests for two bars in a row', () => {
    for (const seed of [31, 32, 33, 34]) {
      const bars = play(seed, 400);
      const counts = bars.map((b) => b.length);
      expect(Math.max(...counts)).toBeLessThanOrEqual(12);
      const free = bars.filter((_, bar) => !chordAt(bar).motif).map((b) => b.length);
      const average = free.reduce((a, b) => a + b, 0) / free.length;
      expect(average).toBeGreaterThan(2.5);
      expect(average).toBeLessThan(6);
      const rests = counts.filter((n) => n === 0).length;
      expect(rests).toBeGreaterThan(10);
      for (let i = 1; i < counts.length; i += 1) expect(counts[i] === 0 && counts[i - 1] === 0).toBe(false);
      // Motif bars are never silent.
      bars.forEach((b, bar) => {
        if (chordAt(bar).motif) expect(b.length).toBeGreaterThanOrEqual(MOTIF.length);
      });
    }
  });
});
