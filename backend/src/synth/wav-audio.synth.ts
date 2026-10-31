import { VoiceAlignment } from '@forge/shared';
import { mulberry32 } from './rng';

export interface WavHeaderInfo {
  sampleRate: number;
  numChannels: number;
  bitsPerSample: number;
  byteRate: number;
  blockAlign: number;
  dataBytes: number;
  durationMs: number;
}

export interface SynthMusicOptions {
  seed: number;
  durationSec: number;
  bpm?: number | null;
  keySignature?: string | null;
  seamlessLoop?: boolean;
  generateStems?: boolean;
  sampleRate?: number;
}

export interface SynthMusicResult {
  masterWav: Buffer;
  stems: Array<{ name: string; wav: Buffer }>;
  durationMs: number;
  sampleRate: number;
  bpm: number;
  keySignature: string;
}

export type SfxCategory =
  | 'WEAPON_HIT'
  | 'UI_CLICK'
  | 'FOOTSTEP'
  | 'MAGIC'
  | 'AMBIENT_FOLEY'
  | 'EXPLOSION'
  | 'CREATURE'
  | 'IMPACT';

export interface SynthSfxOptions {
  seed: number;
  category: SfxCategory;
  durationSec: number;
  loopable?: boolean;
  sampleRate?: number;
}

export interface SynthVoiceOptions {
  seed: number;
  transcript: string;
  speed?: number;
  voiceId?: string;
  sampleRate?: number;
}

/**
 * Encodes one or more Float32Array audio channels (samples in [-1, 1]) into a standard
 * 16-bit PCM RIFF/WAVE Buffer.
 */
export function encodeWavPcm16(channels: Float32Array[], sampleRate = 44100): Buffer {
  const numChannels = Math.max(1, channels.length);
  const numFrames = channels[0]?.length ?? 0;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataBytes = numFrames * blockAlign;

  const buffer = Buffer.alloc(44 + dataBytes);

  // RIFF header
  buffer.write('RIFF', 0, 4, 'ascii');
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write('WAVE', 8, 4, 'ascii');

  // fmt subchunk
  buffer.write('fmt ', 12, 4, 'ascii');
  buffer.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
  buffer.writeUInt16LE(1, 20); // AudioFormat (1 = PCM)
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);

  // data subchunk
  buffer.write('data', 36, 4, 'ascii');
  buffer.writeUInt32LE(dataBytes, 40);

  let offset = 44;
  for (let i = 0; i < numFrames; i++) {
    for (let c = 0; c < numChannels; c++) {
      const sample = channels[c]?.[i] ?? 0;
      const clamped = sample < -1 ? -1 : sample > 1 ? 1 : sample;
      const intVal = clamped < 0 ? Math.round(clamped * 32768) : Math.round(clamped * 32767);
      buffer.writeInt16LE(intVal, offset);
      offset += 2;
    }
  }

  return buffer;
}

export function parseWavHeader(buf: Buffer): WavHeaderInfo {
  if (buf.length < 44) {
    throw new Error('WAV buffer smaller than 44-byte RIFF header');
  }
  const riff = buf.subarray(0, 4).toString('ascii');
  const wave = buf.subarray(8, 12).toString('ascii');
  if (riff !== 'RIFF' || wave !== 'WAVE') {
    throw new Error(`Invalid WAV signature (${riff}/${wave})`);
  }

  const numChannels = buf.readUInt16LE(22);
  const sampleRate = buf.readUInt32LE(24);
  const byteRate = buf.readUInt32LE(28);
  const blockAlign = buf.readUInt16LE(32);
  const bitsPerSample = buf.readUInt16LE(34);
  const dataBytes = buf.readUInt32LE(40);
  const durationMs = byteRate > 0 ? Math.round((dataBytes / byteRate) * 1000) : 0;

  return {
    sampleRate,
    numChannels,
    bitsPerSample,
    byteRate,
    blockAlign,
    dataBytes,
    durationMs,
  };
}

function rootMidiFromKeySignature(keySig: string): number {
  const clean = keySig.trim().toUpperCase();
  const map: Record<string, number> = {
    C: 60,
    'C#': 61,
    DB: 61,
    D: 62,
    'D#': 63,
    EB: 63,
    E: 64,
    F: 65,
    'F#': 66,
    GB: 66,
    G: 67,
    'G#': 68,
    AB: 68,
    A: 57,
    'A#': 58,
    BB: 58,
    B: 59,
  };
  const token = clean.split(/[\s\-_]/)[0] ?? 'D';
  return map[token] ?? 62;
}

function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/**
 * Synthesizes a musical loop with chord progression i-VI-III-VII in the requested key & BPM,
 * including pad, pluck arpeggio, and kick/percussion layers, plus optional isolated stems.
 */
export function synthesizeMusic(opts: SynthMusicOptions): SynthMusicResult {
  const sampleRate = opts.sampleRate ?? 22050;
  const bpm = opts.bpm ?? 92;
  const keySignature = opts.keySignature ?? 'D Dorian';
  const rootMidi = rootMidiFromKeySignature(keySignature);

  // Beat & bar timing; snap loop duration to whole bars if seamlessLoop
  const beatSec = 60 / bpm;
  const barSec = beatSec * 4;
  const requestedSec = Math.max(2, opts.durationSec);
  const totalSec = opts.seamlessLoop
    ? Math.max(barSec, Math.round(requestedSec / barSec) * barSec)
    : requestedSec;

  const numSamples = Math.floor(totalSec * sampleRate);
  const padL = new Float32Array(numSamples);
  const padR = new Float32Array(numSamples);
  const arpL = new Float32Array(numSamples);
  const arpR = new Float32Array(numSamples);
  const drumsL = new Float32Array(numSamples);
  const drumsR = new Float32Array(numSamples);

  // i - VI - III - VII in semitone offsets from root
  const chords: Array<[number, number, number]> = [
    [0, 3, 7],
    [-4, 0, 3],
    [3, 7, 10],
    [-2, 2, 5],
  ];

  const arpPattern = [0, 1, 2, 1, 0, 2, 1, 2];
  const sixteenthSec = beatSec / 2;

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const barIdx = Math.floor(t / barSec);
    const chord = chords[barIdx % chords.length]!;

    // 1. Warm stereo choir/synth pad
    const f0 = midiToHz(rootMidi - 12 + chord[0]);
    const f1 = midiToHz(rootMidi + chord[1]);
    const f2 = midiToHz(rootMidi + chord[2]);
    const padEnv = 0.85 + 0.15 * Math.sin((t / barSec) * Math.PI * 2);
    const pL =
      (Math.sin(2 * Math.PI * f0 * t) * 0.45 +
        Math.sin(2 * Math.PI * (f1 * 1.002) * t) * 0.3 +
        Math.sin(2 * Math.PI * f2 * t) * 0.25) *
      0.28 *
      padEnv;
    const pR =
      (Math.sin(2 * Math.PI * f0 * t) * 0.45 +
        Math.sin(2 * Math.PI * f1 * t) * 0.3 +
        Math.sin(2 * Math.PI * (f2 * 0.998) * t) * 0.25) *
      0.28 *
      padEnv;
    padL[i] = pL;
    padR[i] = pR;

    // 2. Pluck arpeggio (celesta/synth harp)
    const stepIdx = Math.floor(t / sixteenthSec);
    const stepTime = t - stepIdx * sixteenthSec;
    const noteTone = chord[arpPattern[stepIdx % arpPattern.length]!]!;
    const arpFreq = midiToHz(rootMidi + 12 + noteTone);
    const pluckEnv = Math.exp(-stepTime * 11);
    const arpVal =
      (Math.sin(2 * Math.PI * arpFreq * stepTime) +
        0.35 * Math.sin(4 * Math.PI * arpFreq * stepTime)) *
      pluckEnv *
      0.26;
    const pan = stepIdx % 2 === 0 ? 0.75 : 0.35;
    arpL[i] = arpVal * pan;
    arpR[i] = arpVal * (1.1 - pan);

    // 3. Kick on beats
    const beatTime = t % beatSec;
    const kickFreq = 52 + 110 * Math.exp(-beatTime * 32);
    const kickEnv = Math.exp(-beatTime * 12);
    const kickVal = Math.sin(2 * Math.PI * kickFreq * beatTime) * kickEnv * 0.38;
    drumsL[i] = kickVal;
    drumsR[i] = kickVal;
  }

  const masterL = new Float32Array(numSamples);
  const masterR = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    masterL[i] = (padL[i] ?? 0) + (arpL[i] ?? 0) + (drumsL[i] ?? 0);
    masterR[i] = (padR[i] ?? 0) + (arpR[i] ?? 0) + (drumsR[i] ?? 0);
  }

  const masterWav = encodeWavPcm16([masterL, masterR], sampleRate);
  const stems: Array<{ name: string; wav: Buffer }> = [];
  if (opts.generateStems) {
    stems.push({ name: 'pad', wav: encodeWavPcm16([padL, padR], sampleRate) });
    stems.push({ name: 'arp', wav: encodeWavPcm16([arpL, arpR], sampleRate) });
    stems.push({ name: 'drums', wav: encodeWavPcm16([drumsL, drumsR], sampleRate) });
  }

  return {
    masterWav,
    stems,
    durationMs: Math.round((numSamples / sampleRate) * 1000),
    sampleRate,
    bpm,
    keySignature,
  };
}

/**
 * Synthesizes category-specific sound effects (SFX) as PCM16 WAV buffers.
 */
export function synthesizeSfx(opts: SynthSfxOptions): {
  wav: Buffer;
  durationMs: number;
  sampleRate: number;
} {
  const rng = mulberry32(opts.seed);
  const sampleRate = opts.sampleRate ?? 44100;
  const durationSec = Math.max(0.25, opts.durationSec);
  const numSamples = Math.floor(durationSec * sampleRate);
  const samples = new Float32Array(numSamples);

  let lpState = 0;
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const white = rng() * 2 - 1;
    let val = 0;

    switch (opts.category) {
      case 'UI_CLICK': {
        // 8ms transient blip + high crystalline bell harmonic
        const blip = t < 0.012 ? (Math.sin(2 * Math.PI * 1850 * t) >= 0 ? 0.6 : -0.6) : 0;
        const chime =
          (Math.sin(2 * Math.PI * 2637 * t) + 0.5 * Math.sin(2 * Math.PI * 3951 * t)) *
          Math.exp(-t * 14) *
          0.45;
        val = blip + chime;
        break;
      }
      case 'WEAPON_HIT':
      case 'IMPACT': {
        // Noise burst + pitched thump + metallic ring
        const thumpFreq = 75 + 210 * Math.exp(-t * 28);
        const thump = Math.sin(2 * Math.PI * thumpFreq * t) * Math.exp(-t * 10) * 0.55;
        const burst = white * Math.exp(-t * 32) * 0.45;
        const ring =
          (Math.sin(2 * Math.PI * 1420 * t) + 0.6 * Math.sin(2 * Math.PI * 2190 * t)) *
          Math.exp(-t * 6.5) *
          0.25;
        val = thump + burst + ring;
        break;
      }
      case 'FOOTSTEP': {
        // Two filtered noise steps
        const stepPeriod = durationSec / 2;
        const localT = t % stepPeriod;
        lpState = lpState * 0.86 + white * 0.14;
        const stepEnv = Math.exp(-localT * 22);
        val = lpState * stepEnv * 1.4;
        break;
      }
      case 'MAGIC': {
        // Rising FM shimmer + sparkle overtones
        const carrier = 420 + (t / durationSec) * 680;
        const mod = Math.sin(2 * Math.PI * 18 * t) * 85;
        const env = Math.sin(Math.min(1, t / durationSec) * Math.PI);
        val =
          (Math.sin(2 * Math.PI * (carrier + mod) * t) * 0.45 +
            Math.sin(2 * Math.PI * carrier * 2.5 * t) * 0.25) *
          env;
        break;
      }
      case 'EXPLOSION': {
        // Long low-passed noise + sub boom
        lpState = lpState * 0.94 + white * 0.06;
        const sub = Math.sin(2 * Math.PI * (42 + 60 * Math.exp(-t * 8)) * t) * Math.exp(-t * 3.2);
        const env = Math.exp(-t * 2.1);
        val = (lpState * 1.8 + sub * 0.55) * env;
        break;
      }
      case 'AMBIENT_FOLEY':
      case 'CREATURE':
      default: {
        lpState = lpState * 0.9 + white * 0.1;
        const modFreq = 180 + 60 * Math.sin(2 * Math.PI * 3.5 * t);
        val = (lpState * 0.7 + Math.sin(2 * Math.PI * modFreq * t) * 0.3) * 0.6;
        break;
      }
    }

    samples[i] = val;
  }

  const wav = encodeWavPcm16([samples], sampleRate);
  return {
    wav,
    durationMs: Math.round((numSamples / sampleRate) * 1000),
    sampleRate,
  };
}

/**
 * Synthesizes a character voice line with formant-like vowel buzz modulated by syllables
 * and returns word-level timestamp alignment (`VoiceAlignment`).
 */
export function synthesizeVoice(opts: SynthVoiceOptions): {
  wav: Buffer;
  alignment: VoiceAlignment;
  durationMs: number;
  sampleRate: number;
} {
  const rng = mulberry32(opts.seed);
  const sampleRate = opts.sampleRate ?? 24000;
  const speed = opts.speed ?? 1.0;

  const rawWords = opts.transcript
    .replace(/\[[^\]]*\]/g, '')
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0);
  const words = rawWords.length > 0 ? rawWords : ['Hello'];

  const voiceId = (opts.voiceId ?? '').toLowerCase();
  const basePitchHz = voiceId.includes('soprano')
    ? 245
    : voiceId.includes('alto')
      ? 195
      : voiceId.includes('bass')
        ? 98
        : voiceId.includes('baritone')
          ? 122
          : 155;

  const wordTimings: Array<{ word: string; startMs: number; endMs: number }> = [];
  let cursorMs = 80;
  for (const w of words) {
    const syllables = Math.max(1, Math.ceil(w.length / 3));
    const wordDurMs = Math.round(((150 + syllables * 95) / speed));
    const startMs = cursorMs;
    const endMs = startMs + wordDurMs;
    wordTimings.push({ word: w, startMs, endMs });
    cursorMs = endMs + Math.round(55 / speed);
  }

  const totalDurationMs = cursorMs + 120;
  const numSamples = Math.floor((totalDurationMs / 1000) * sampleRate);
  const samples = new Float32Array(numSamples);

  for (let wIdx = 0; wIdx < wordTimings.length; wIdx++) {
    const wt = wordTimings[wIdx]!;
    const startSample = Math.floor((wt.startMs / 1000) * sampleRate);
    const endSample = Math.min(numSamples, Math.floor((wt.endMs / 1000) * sampleRate));
    const wordLen = Math.max(1, endSample - startSample);
    const f0 = basePitchHz * (0.94 + (wIdx % 4) * 0.04 + (rng() - 0.5) * 0.03);
    const formant1 = f0 * 3;
    const formant2 = f0 * 7;

    for (let s = startSample; s < endSample; s++) {
      const local = (s - startSample) / wordLen;
      const t = s / sampleRate;
      const env = Math.sin(local * Math.PI);
      const vibrato = 1 + 0.012 * Math.sin(2 * Math.PI * 5.5 * t);
      const glottal =
        Math.sin(2 * Math.PI * f0 * vibrato * t) * 0.5 +
        Math.sin(2 * Math.PI * formant1 * t) * 0.3 +
        Math.sin(2 * Math.PI * formant2 * t) * 0.15;
      samples[s] = glottal * env * 0.55;
    }
  }

  const wav = encodeWavPcm16([samples], sampleRate);
  return {
    wav,
    alignment: { words: wordTimings },
    durationMs: totalDurationMs,
    sampleRate,
  };
}
