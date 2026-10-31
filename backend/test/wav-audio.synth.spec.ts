import {
  encodeWavPcm16,
  parseWavHeader,
  synthesizeMusic,
  synthesizeSfx,
  synthesizeVoice,
} from '../src/synth/wav-audio.synth';

describe('wav-audio.synth', () => {
  it('encodes mono and stereo Float32Arrays into valid RIFF/WAVE PCM16 buffers', () => {
    const sampleRate = 44100;
    const frames = 4410; // 100 ms
    const left = new Float32Array(frames);
    const right = new Float32Array(frames);
    for (let i = 0; i < frames; i++) {
      left[i] = Math.sin((2 * Math.PI * 440 * i) / sampleRate);
      right[i] = Math.cos((2 * Math.PI * 440 * i) / sampleRate);
    }

    const wav = encodeWavPcm16([left, right], sampleRate);
    expect(wav.length).toBe(44 + frames * 2 * 2);

    const header = parseWavHeader(wav);
    expect(header.sampleRate).toBe(44100);
    expect(header.numChannels).toBe(2);
    expect(header.bitsPerSample).toBe(16);
    expect(header.blockAlign).toBe(4);
    expect(header.byteRate).toBe(44100 * 4);
    expect(header.dataBytes).toBe(frames * 4);
    expect(header.durationMs).toBe(100);
  });

  it('synthesizes loopable music with stems in the requested key and BPM', () => {
    const res = synthesizeMusic({
      seed: 20261022,
      durationSec: 8,
      bpm: 120,
      keySignature: 'D Dorian',
      seamlessLoop: true,
      generateStems: true,
      sampleRate: 22050,
    });

    const header = parseWavHeader(res.masterWav);
    expect(header.numChannels).toBe(2);
    expect(header.sampleRate).toBe(22050);
    expect(res.stems).toHaveLength(3);
    expect(res.stems.map((s) => s.name)).toEqual(['pad', 'arp', 'drums']);
    for (const stem of res.stems) {
      const sh = parseWavHeader(stem.wav);
      expect(sh.dataBytes).toBe(header.dataBytes);
    }
  });

  it('synthesizes SFX across categories with valid PCM16 data', () => {
    const categories = ['WEAPON_HIT', 'UI_CLICK', 'FOOTSTEP', 'MAGIC', 'EXPLOSION'] as const;
    for (const category of categories) {
      const sfx = synthesizeSfx({
        seed: 101,
        category,
        durationSec: 1.0,
        sampleRate: 22050,
      });
      const header = parseWavHeader(sfx.wav);
      expect(header.numChannels).toBe(1);
      expect(header.durationMs).toBe(1000);
    }
  });

  it('synthesizes voice audio with word-level timestamp alignment', () => {
    const voice = synthesizeVoice({
      seed: 777,
      transcript: 'Every star remembers the fallen firmament.',
      voiceId: 'demo-alto-warm',
      speed: 1.0,
    });

    const header = parseWavHeader(voice.wav);
    expect(header.numChannels).toBe(1);
    expect(header.durationMs).toBeGreaterThan(500);
    expect(voice.alignment.words).toHaveLength(6);
    expect(voice.alignment.words[0]?.word).toBe('Every');
    expect(voice.alignment.words[5]?.word).toBe('firmament.');
    for (const w of voice.alignment.words) {
      expect(w.endMs).toBeGreaterThan(w.startMs);
    }
  });
});
