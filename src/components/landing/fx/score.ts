// The VATE theme, written as data. Nothing here touches the Web Audio API: this file only decides
// which notes sound and when, so the music can be unit-tested. fx/audio.ts turns it into sound.
//
// The piece was written for VATE:
//  - the four-note motif spells the name. In the classic musical cryptogram the alphabet is
//    written in rows under the note names A–G, which gives V→A, A→A, T→F, E→E;
//  - the harmony is five chords in C major that move under three notes which never leave
//    (E, G and C);
//  - between motifs, bell notes wander over the C major pentatonic scale, which fits every chord.

/** Seconds each chord lasts. */
export const BAR = 12;

const SEMITONE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** 'A4' → 69, the MIDI note number. Natural notes only: the piece has no sharps or flats. */
export function midi(note: string): number {
  const match = /^([A-G])(\d)$/.exec(note);
  if (!match) throw new Error(`Not a note: ${note}`);
  return 12 * (Number(match[2]) + 1) + SEMITONE[match[1]];
}

/** Frequency of a MIDI note number, with A4 = 440 Hz. */
export const hz = (note: number): number => 440 * 2 ** ((note - 69) / 12);

/** Spells a word as note names: the alphabet runs in rows under A B C D E F G. */
export function spell(word: string): string[] {
  return [...word.toUpperCase()].filter((c) => c >= 'A' && c <= 'Z').map((c) => 'ABCDEFG'[(c.charCodeAt(0) - 65) % 7]);
}

/** V-A-T-E as pitches: A4, the A an octave above, then F5 and E5. */
export const MOTIF: number[] = spell('VATE').map((name, i) => midi(`${name}${[4, 5, 5, 5][i]}`));
/** Seconds into the bar at which each motif note sounds; the last one waits a little longer. */
export const MOTIF_AT = [1, 2, 3, 4.5];
const MOTIF_LEVEL = [0.85, 1, 0.9, 0.95];
const MOTIF_PAN = [-0.25, 0.25, 0.1, -0.1];

export interface Chord {
  name: string;
  bass: number;
  /** The inner notes, low to high. Together with the halo they complete the chord. */
  voices: number[];
  /** The VATE motif is played over this chord. */
  motif: boolean;
}

const chord = (name: string, bass: string, voices: string[], motif = false): Chord => ({
  name,
  bass: midi(bass),
  voices: voices.map(midi),
  motif,
});

const F = chord('Fmaj9', 'F2', ['C3', 'A3'], true);
const C = chord('C/E', 'E2', ['C3', 'G3', 'C4']);
const Am = chord('Am7', 'A2', ['E3', 'C4']);
const G = chord('G6/9', 'G2', ['D3', 'A3']);
const Dm = chord('Dm11', 'D2', ['F3', 'C4']);

// The inner notes are chosen so that every chord hands at least one of them to the next: the
// harmony changes by a note or two at a time, never all at once.
const PHRASE_A = [F, C, Am, G];
const PHRASE_B = [Dm, Am, F, G];

/** One pass through the piece: A A B A, sixteen chords (3 min 12 s). The bells differ every pass. */
export const FORM: Chord[] = [...PHRASE_A, ...PHRASE_A, ...PHRASE_B, ...PHRASE_A];

/** The three notes that sound throughout. Each belongs to every chord above. */
export const HALO: number[] = ['E4', 'G4', 'C5'].map(midi);

/** C major pentatonic, two octaves: no F and no B, so no bell can clash with a chord. */
export const BELLS: number[] = ['C5', 'D5', 'E5', 'G5', 'A5', 'C6', 'D6', 'E6'].map(midi);

/** Interface ticks take their pitch from the same scale, in turn. */
export const TICKS: number[] = ['E6', 'G6', 'D6', 'C6'].map(midi);

export const chordAt = (bar: number): Chord => FORM[((bar % FORM.length) + FORM.length) % FORM.length];

export interface Pad {
  note: number;
  /** How many bars the note is held. */
  bars: number;
  bass: boolean;
  /** The note may fade slowly over the next chord instead of making way for it. */
  linger: boolean;
}

/**
 * Two low notes closer together than this many hertz beat against each other while both sound.
 * A note lingers into the next chord only if it keeps this distance from everything in it.
 */
export const CLEAR = 40;

const clearOf = (note: number, next: Chord): boolean =>
  [next.bass, next.bass + 12, ...next.voices].every((other) => Math.abs(hz(other) - hz(note)) >= CLEAR);

/**
 * The sustained notes that begin in a bar. A note the next chord shares is held through instead
 * of being struck again. `fresh` means nothing is sounding yet, as in the very first bar.
 */
export function padsAt(bar: number, fresh: boolean): Pad[] {
  const now = chordAt(bar);
  const before = fresh ? null : chordAt(bar - 1);
  // The bass never lingers: down there every neighbouring note is too close.
  const pads: Pad[] = [{ note: now.bass, bars: 1, bass: true, linger: false }];
  for (const note of now.voices) {
    if (before?.voices.includes(note)) continue;
    let bars = 1;
    while (bars < FORM.length && chordAt(bar + bars).voices.includes(note)) bars += 1;
    pads.push({ note, bars, bass: false, linger: clearOf(note, chordAt(bar + bars)) });
  }
  return pads;
}

export interface Bell {
  /** Seconds from the start of the bar. */
  at: number;
  note: number;
  /** Loudness, 0–1. */
  level: number;
  /** Stereo position, −1 (left) to 1 (right). */
  pan: number;
  /** Part of the VATE motif. */
  lead: boolean;
}

/** Where the wandering bell line is, carried from bar to bar. */
export interface Walk {
  step: number;
  rested: boolean;
}

export const newWalk = (): Walk => ({ step: 3, rested: false });

/**
 * The bell notes of one bar. A motif bar plays V-A-T-E and then leaves room for it to ring;
 * other bars carry a sparse line that moves by one or two scale steps, and now and then a bar
 * stays silent (never two in a row).
 */
export function bellsAt(bar: number, rnd: () => number, walk: Walk): Bell[] {
  const bells: Bell[] = [];
  let at = 0.6 + rnd() * 2;
  if (chordAt(bar).motif) {
    MOTIF.forEach((note, i) => bells.push({ at: MOTIF_AT[i], note, level: MOTIF_LEVEL[i], pan: MOTIF_PAN[i], lead: true }));
    at = 7.5 + rnd() * 1.5;
  } else if (!walk.rested && rnd() < 0.14) {
    walk.rested = true;
    return bells;
  }
  walk.rested = false;
  const top = BELLS.length - 1;
  const wander = (): number => {
    const next = walk.step + [-2, -1, -1, 1, 1, 2][Math.floor(rnd() * 6)];
    walk.step = next < 0 ? -next : next > top ? 2 * top - next : next;
    return BELLS[walk.step];
  };
  while (at < BAR - 0.8) {
    const level = 0.5 + rnd() * 0.35;
    const pan = (rnd() * 2 - 1) * 0.6;
    bells.push({ at, note: wander(), level, pan, lead: false });
    // Sometimes a second, softer note answers a moment later.
    if (rnd() < 0.3) bells.push({ at: at + 0.32 + rnd() * 0.25, note: wander(), level: level * 0.8, pan: -pan, lead: false });
    at += 1.8 + rnd() * 3.4;
  }
  return bells;
}

/** A small seeded random generator (mulberry32): the same seed always gives the same music. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
