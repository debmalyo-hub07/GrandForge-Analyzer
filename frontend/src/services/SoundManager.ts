import type { MoveSound } from '../utils/moveSound';

/**
 * Board sounds, synthesized at runtime with WebAudio.
 *
 * No audio files ship with the app. That is a deliberate three-way win: nothing
 * to license or attribute (the platform must not depend on anyone else's
 * assets), nothing added to the bundle or the free-tier bandwidth budget, and no
 * network request between a move and its sound.
 *
 * Every voice is a short shaped tone. The envelope matters more than the pitch:
 * a chess move sound wants a fast attack and a quick decay so rapid navigation
 * through a game does not smear into a drone.
 */

interface VoiceSpec {
  /** Partials, as [frequency in Hz, relative gain]. */
  partials: [number, number][];
  /** Total length in seconds. Keep under ~0.35 s so fast arrowing stays crisp. */
  duration: number;
  type: OscillatorType;
  /** Peak gain before the master volume is applied. */
  peak: number;
  /** Fraction of duration spent rising to peak. Small = percussive. */
  attack: number;
  /** Semitone glide applied over the note; negative falls. */
  glide?: number;
  /** Extra voices fired after a delay, for two-part sounds. */
  echo?: { delay: number; spec: Omit<VoiceSpec, 'echo'> };
}

// Wooden-piece character comes from a low fundamental plus a quiet high partial
// for the "click" of contact. Captures sit lower and dirtier than quiet moves;
// check is bright and cuts through; game end resolves downward.
const VOICES: Record<MoveSound, VoiceSpec> = {
  move: {
    partials: [[210, 1], [430, 0.28]],
    duration: 0.085,
    type: 'triangle',
    peak: 0.5,
    attack: 0.008,
  },
  capture: {
    partials: [[135, 1], [270, 0.45], [95, 0.6]],
    duration: 0.13,
    type: 'sawtooth',
    peak: 0.42,
    attack: 0.005,
    glide: -3,
  },
  castle: {
    // Two knocks — the king, then the rook.
    partials: [[190, 1], [380, 0.25]],
    duration: 0.07,
    type: 'triangle',
    peak: 0.45,
    attack: 0.006,
    echo: {
      delay: 0.105,
      spec: {
        partials: [[230, 1], [460, 0.25]],
        duration: 0.075,
        type: 'triangle',
        peak: 0.4,
        attack: 0.006,
      },
    },
  },
  promote: {
    partials: [[440, 1], [660, 0.5], [880, 0.3]],
    duration: 0.22,
    type: 'triangle',
    peak: 0.34,
    attack: 0.02,
    glide: 7,
  },
  check: {
    partials: [[720, 1], [1080, 0.4]],
    duration: 0.15,
    type: 'square',
    peak: 0.2,
    attack: 0.004,
    echo: {
      delay: 0.14,
      spec: {
        partials: [[900, 1], [1350, 0.35]],
        duration: 0.16,
        type: 'square',
        peak: 0.17,
        attack: 0.004,
      },
    },
  },
  gameEnd: {
    partials: [[330, 1], [415, 0.7], [495, 0.55]],
    duration: 0.34,
    type: 'triangle',
    peak: 0.3,
    attack: 0.03,
    glide: -5,
  },
};

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let volume = 0.7;

/** Browsers refuse to start an AudioContext outside a user gesture, and a
 *  context created too early lands in 'suspended'. So the context is created on
 *  the first actual play — by then the user has clicked or pressed a key. */
function ensureContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (ctx) return ctx;
  const Ctor: typeof AudioContext | undefined =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = volume;
    master.connect(ctx.destination);
    return ctx;
  } catch {
    // Audio is a nicety; a browser that refuses one must not break the board.
    ctx = null;
    master = null;
    return null;
  }
}

function playVoice(audio: AudioContext, out: GainNode, spec: VoiceSpec, at: number) {
  const { partials, duration, type, peak, attack, glide } = spec;
  const totalGain = partials.reduce((sum, [, g]) => sum + g, 0) || 1;

  for (const [freq, rel] of partials) {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, at);
    if (glide) {
      // Semitone ratio: 2^(n/12). Exponential ramp because pitch is perceived
      // logarithmically — a linear ramp sounds like it slows down.
      osc.frequency.exponentialRampToValueAtTime(freq * Math.pow(2, glide / 12), at + duration);
    }

    const level = (peak * rel) / totalGain;
    // Ramp from a tiny nonzero value: exponentialRamp cannot touch 0, and a
    // linear attack from true zero clicks at these durations.
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(Math.max(level, 0.0002), at + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);

    osc.connect(gain);
    gain.connect(out);
    osc.start(at);
    osc.stop(at + duration + 0.02);
  }
}

/** Play a board sound. Silent and allocation-free when audio is unavailable
 *  (node/tests, no AudioContext, or a blocked context), so callers never guard. */
export function playMoveSound(sound: MoveSound): void {
  const audio = ensureContext();
  if (!audio || !master) return;
  // A context can be suspended by autoplay policy or by the tab backgrounding.
  // resume() is a promise we deliberately do not await — the note scheduled
  // below is inaudible if it fails, which is the correct outcome anyway.
  if (audio.state === 'suspended') void audio.resume().catch(() => {});

  const spec = VOICES[sound];
  if (!spec) return;
  const now = audio.currentTime;
  try {
    playVoice(audio, master, spec, now);
    if (spec.echo) playVoice(audio, master, spec.echo.spec as VoiceSpec, now + spec.echo.delay);
  } catch {
    /* a mid-teardown context can throw on start(); never surface it */
  }
}

/** 0..1. Applied to the master gain, so it takes effect on the next note. */
export function setSoundVolume(v: number): void {
  volume = Math.max(0, Math.min(1, v));
  if (master) master.gain.value = volume;
}

/** Release the AudioContext. Only needed by tests and hot-reload. */
export function disposeSounds(): void {
  try { void ctx?.close(); } catch { /* noop */ }
  ctx = null;
  master = null;
}
