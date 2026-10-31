import { AssetFileRole, VoiceAlignment } from '@forge/shared';
import { Injectable } from '@nestjs/common';
import { parseWavHeader } from '../../synth/wav-audio.synth';
import { ProcessedFileEntry } from './icon.post';

export interface CharacterAlignmentPayload {
  characters?: string[];
  character_start_times_seconds?: number[];
  character_end_times_seconds?: number[];
}

export interface AudioPostProcessResult {
  primaryBuffer: Buffer;
  mimeType: string;
  fileName: string;
  durationMs: number;
  sampleRate: number;
  alignment: VoiceAlignment | null;
  extraFiles: ProcessedFileEntry[];
}

const MPEG1_LAYER3_BITRATES = [
  0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0,
];
const MPEG2_LAYER3_BITRATES = [
  0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0,
];
const MPEG1_SAMPLE_RATES = [44100, 48000, 32000, 0];
const MPEG2_SAMPLE_RATES = [22050, 24000, 16000, 0];
const MPEG25_SAMPLE_RATES = [11025, 12000, 8000, 0];

function countSyllables(word: string): number {
  const cleaned = word.toLowerCase().replace(/[^a-z]/g, '');
  if (cleaned.length <= 3) return 1;
  const withoutSilentE = cleaned.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '');
  const matches = withoutSilentE.match(/[aeiouy]{1,2}/g);
  return Math.max(1, matches ? matches.length : 1);
}

@Injectable()
export class AudioPostProcessor {
  wrapPcm16ToWav(
    pcmBuffer: Buffer,
    sampleRate = 44100,
    numChannels = 1,
  ): Buffer {
    const bitsPerSample = 16;
    const blockAlign = numChannels * (bitsPerSample / 8);
    const byteRate = sampleRate * blockAlign;
    const dataBytes = pcmBuffer.length;

    const header = Buffer.alloc(44);
    header.write('RIFF', 0, 4, 'ascii');
    header.writeUInt32LE(36 + dataBytes, 4);
    header.write('WAVE', 8, 4, 'ascii');
    header.write('fmt ', 12, 4, 'ascii');
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(numChannels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bitsPerSample, 34);
    header.write('data', 36, 4, 'ascii');
    header.writeUInt32LE(dataBytes, 40);

    return Buffer.concat([header, pcmBuffer]);
  }

  probeMp3Header(buf: Buffer): { durationMs: number; sampleRate: number } | null {
    if (buf.length < 16) return null;
    let offset = 0;

    // Skip ID3v2 tag if present
    if (
      buf[0] === 0x49 &&
      buf[1] === 0x44 &&
      buf[2] === 0x33 &&
      buf.length >= 10
    ) {
      const size =
        ((buf[6]! & 0x7f) << 21) |
        ((buf[7]! & 0x7f) << 14) |
        ((buf[8]! & 0x7f) << 7) |
        (buf[9]! & 0x7f);
      offset = 10 + size;
    }

    const limit = Math.min(buf.length - 4, offset + 16384);
    for (let i = offset; i <= limit; i++) {
      if (buf[i] === 0xff && (buf[i + 1]! & 0xe0) === 0xe0) {
        const b1 = buf[i + 1]!;
        const b2 = buf[i + 2]!;
        const versionBits = (b1 >> 3) & 0x03;
        const layerBits = (b1 >> 1) & 0x03;
        if (versionBits === 1 || layerBits === 0) continue;

        const bitrateIdx = (b2 >> 4) & 0x0f;
        const srIdx = (b2 >> 2) & 0x03;
        if (bitrateIdx === 0 || bitrateIdx === 15 || srIdx === 3) continue;

        const isMpeg1 = versionBits === 3;
        const sampleRate = isMpeg1
          ? (MPEG1_SAMPLE_RATES[srIdx] ?? 44100)
          : versionBits === 2
            ? (MPEG2_SAMPLE_RATES[srIdx] ?? 22050)
            : (MPEG25_SAMPLE_RATES[srIdx] ?? 11025);
        const bitrateKbps = isMpeg1
          ? (MPEG1_LAYER3_BITRATES[bitrateIdx] ?? 128)
          : (MPEG2_LAYER3_BITRATES[bitrateIdx] ?? 64);

        if (sampleRate <= 0 || bitrateKbps <= 0) continue;

        const samplesPerFrame = isMpeg1 ? 1152 : 576;
        // Check for Xing/Info VBR header inside first frame
        const xingSearchEnd = Math.min(buf.length - 12, i + 64);
        for (let x = i + 4; x < xingSearchEnd; x++) {
          const tag = buf.subarray(x, x + 4).toString('ascii');
          if (tag === 'Xing' || tag === 'Info') {
            const flags = buf.readUInt32BE(x + 4);
            if ((flags & 0x01) !== 0 && x + 12 <= buf.length) {
              const totalFrames = buf.readUInt32BE(x + 8);
              if (totalFrames > 0) {
                const durationMs = Math.max(
                  50,
                  Math.round((totalFrames * samplesPerFrame * 1000) / sampleRate),
                );
                return { durationMs, sampleRate };
              }
            }
          }
        }

        const audioBytes = Math.max(1, buf.length - i);
        const durationMs = Math.max(
          50,
          Math.round((audioBytes * 8) / bitrateKbps),
        );
        return { durationMs, sampleRate };
      }
    }
    return null;
  }

  probeOggHeader(buf: Buffer): { durationMs: number; sampleRate: number } | null {
    if (buf.length < 58 || buf.subarray(0, 4).toString('ascii') !== 'OggS') {
      return null;
    }

    let sampleRate = 44100;
    const vorbisIdx = buf.indexOf(Buffer.from('\x01vorbis', 'binary'));
    if (vorbisIdx >= 0 && vorbisIdx + 16 <= buf.length) {
      const sr = buf.readUInt32LE(vorbisIdx + 11);
      if (sr >= 8000 && sr <= 192000) {
        sampleRate = sr;
      }
    }

    // Find the last OggS page to read its 64-bit granule position
    let lastGranule = 0;
    const searchStart = Math.max(0, buf.length - 65536);
    for (let i = buf.length - 27; i >= searchStart; i--) {
      if (
        buf[i] === 0x4f &&
        buf[i + 1] === 0x67 &&
        buf[i + 2] === 0x67 &&
        buf[i + 3] === 0x53
      ) {
        const low = buf.readUInt32LE(i + 6);
        const high = buf.readInt32LE(i + 10);
        if (high >= 0) {
          lastGranule = high * 4294967296 + low;
          break;
        }
      }
    }

    if (lastGranule > 0 && sampleRate > 0) {
      const durationMs = Math.max(
        50,
        Math.round((lastGranule * 1000) / sampleRate),
      );
      return { durationMs, sampleRate };
    }
    return null;
  }

  convertCharacterAlignmentToWords(
    charAlign: CharacterAlignmentPayload,
  ): VoiceAlignment | null {
    const chars = charAlign.characters;
    const starts = charAlign.character_start_times_seconds;
    const ends = charAlign.character_end_times_seconds;
    if (!Array.isArray(chars) || chars.length === 0) {
      return null;
    }

    const words: Array<{ word: string; startMs: number; endMs: number }> = [];
    let currentWord = '';
    let wordStartSec: number | null = null;
    let wordEndSec = 0;

    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i] ?? '';
      const s = starts?.[i] ?? wordEndSec;
      const e = ends?.[i] ?? s;

      if (/\s/.test(ch)) {
        if (currentWord.length > 0 && wordStartSec !== null) {
          words.push({
            word: currentWord,
            startMs: Math.round(wordStartSec * 1000),
            endMs: Math.round(wordEndSec * 1000),
          });
          currentWord = '';
          wordStartSec = null;
        }
      } else {
        if (wordStartSec === null) {
          wordStartSec = s;
        }
        currentWord += ch;
        wordEndSec = e;
      }
    }

    if (currentWord.length > 0 && wordStartSec !== null) {
      words.push({
        word: currentWord,
        startMs: Math.round(wordStartSec * 1000),
        endMs: Math.round(wordEndSec * 1000),
      });
    }

    return words.length > 0 ? { words, source: 'PROVIDER' } : null;
  }

  /**
   * Estimates word-level alignment timestamps when a TTS provider does not return
   * native word/character alignment. Uses WAV RMS envelope detection to locate
   * speech onset/offset and distributes words proportionally to syllable count.
   */
  estimateWordAlignment(
    transcript: string,
    durationMs: number,
    wavBuffer?: Buffer,
  ): VoiceAlignment | null {
    const tokens = transcript
      .trim()
      .split(/\s+/)
      .filter((w) => w.length > 0);
    if (tokens.length === 0 || durationMs <= 0) {
      return null;
    }

    let speechStartMs = Math.min(40, Math.floor(durationMs * 0.04));
    let speechEndMs = Math.max(
      speechStartMs + 50,
      durationMs - Math.min(60, Math.floor(durationMs * 0.05)),
    );

    // If WAV PCM data is available, detect first/last voiced 20ms window above RMS threshold
    if (
      wavBuffer &&
      wavBuffer.length > 44 &&
      wavBuffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      wavBuffer.subarray(8, 12).toString('ascii') === 'WAVE'
    ) {
      try {
        const info = parseWavHeader(wavBuffer);
        const dataOffset = 44;
        const bytesPerSample = Math.max(1, Math.floor(info.bitsPerSample / 8));
        if (bytesPerSample === 2 && info.sampleRate > 0) {
          const totalSamples = Math.floor(
            Math.min(info.dataBytes, wavBuffer.length - dataOffset) /
              (2 * info.numChannels),
          );
          const winSamples = Math.max(64, Math.floor(info.sampleRate * 0.02));
          const winCount = Math.floor(totalSamples / winSamples);
          if (winCount > 2) {
            const rmsValues: number[] = [];
            let peakRms = 0;
            for (let w = 0; w < winCount; w++) {
              let sumSq = 0;
              const baseSample = w * winSamples;
              for (let s = 0; s < winSamples; s++) {
                const byteIdx =
                  dataOffset + (baseSample + s) * info.numChannels * 2;
                if (byteIdx + 2 <= wavBuffer.length) {
                  const val = wavBuffer.readInt16LE(byteIdx) / 32768;
                  sumSq += val * val;
                }
              }
              const rms = Math.sqrt(sumSq / winSamples);
              rmsValues.push(rms);
              if (rms > peakRms) peakRms = rms;
            }
            const threshold = Math.max(0.005, peakRms * 0.08);
            const firstVoiced = rmsValues.findIndex((r) => r >= threshold);
            let lastVoiced = -1;
            for (let i = rmsValues.length - 1; i >= 0; i--) {
              if ((rmsValues[i] ?? 0) >= threshold) {
                lastVoiced = i;
                break;
              }
            }
            if (firstVoiced >= 0 && lastVoiced >= firstVoiced) {
              speechStartMs = Math.round(firstVoiced * 20);
              speechEndMs = Math.min(
                durationMs,
                Math.max(speechStartMs + 50, Math.round((lastVoiced + 1) * 20)),
              );
            }
          }
        }
      } catch {
        // Keep default boundaries
      }
    }

    const weights = tokens.map((w) => {
      const syl = countSyllables(w);
      const pauseWeight = /[.!?]$/.test(w) ? 0.6 : /[,;:]$/.test(w) ? 0.3 : 0;
      return syl + pauseWeight;
    });
    const totalWeight = weights.reduce((acc, v) => acc + v, 0) || 1;
    const spanMs = Math.max(tokens.length * 20, speechEndMs - speechStartMs);

    const words: Array<{ word: string; startMs: number; endMs: number }> = [];
    let cursorMs = speechStartMs;
    for (let i = 0; i < tokens.length; i++) {
      const word = tokens[i]!;
      const weight = weights[i]!;
      const slotMs = Math.max(20, Math.round((weight / totalWeight) * spanMs));
      const startMs = Math.min(speechEndMs - 10, cursorMs);
      const endMs =
        i === tokens.length - 1
          ? speechEndMs
          : Math.min(speechEndMs, startMs + Math.max(15, slotMs - 10));
      words.push({ word, startMs, endMs: Math.max(startMs + 10, endMs) });
      cursorMs = startMs + slotMs;
    }

    return { words, source: 'ESTIMATED' };
  }

  process(
    rawBuffer: Buffer,
    mimeType: string,
    fileName: string,
    outputMeta?: Record<string, unknown>,
  ): AudioPostProcessResult {
    let buffer = rawBuffer;
    let effectiveMime = mimeType;
    let effectiveName = fileName;

    if (mimeType === 'audio/pcm') {
      const pcmRate =
        typeof outputMeta?.['pcmSampleRate'] === 'number'
          ? outputMeta['pcmSampleRate']
          : 44100;
      buffer = this.wrapPcm16ToWav(rawBuffer, pcmRate, 1);
      effectiveMime = 'audio/wav';
      effectiveName = fileName.replace(/\.[a-z0-9]+$/i, '') + '.wav';
    }

    let durationMs =
      typeof outputMeta?.['durationMs'] === 'number'
        ? outputMeta['durationMs']
        : 0;
    let sampleRate =
      typeof outputMeta?.['sampleRate'] === 'number'
        ? outputMeta['sampleRate']
        : 44100;

    if (
      buffer.length >= 44 &&
      buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buffer.subarray(8, 12).toString('ascii') === 'WAVE'
    ) {
      try {
        const info = parseWavHeader(buffer);
        durationMs = info.durationMs;
        sampleRate = info.sampleRate;
      } catch {
        // Keep fallback values
      }
    } else if (
      buffer.length >= 58 &&
      buffer.subarray(0, 4).toString('ascii') === 'OggS'
    ) {
      const oggInfo = this.probeOggHeader(buffer);
      if (oggInfo) {
        if (durationMs === 0) durationMs = oggInfo.durationMs;
        sampleRate = oggInfo.sampleRate;
      }
    } else {
      const mp3Info = this.probeMp3Header(buffer);
      if (mp3Info) {
        if (durationMs === 0) durationMs = mp3Info.durationMs;
        sampleRate = mp3Info.sampleRate;
      } else if (durationMs === 0) {
        durationMs = Math.max(250, Math.round((buffer.length * 8) / 128));
      }
    }

    let alignment: VoiceAlignment | null = null;
    if (
      outputMeta?.['alignment'] &&
      typeof outputMeta['alignment'] === 'object'
    ) {
      const rawAlign = outputMeta['alignment'] as VoiceAlignment;
      alignment = {
        words: rawAlign.words,
        source: rawAlign.source ?? 'PROVIDER',
      };
    } else if (
      outputMeta?.['characterAlignment'] &&
      typeof outputMeta['characterAlignment'] === 'object'
    ) {
      alignment = this.convertCharacterAlignmentToWords(
        outputMeta['characterAlignment'] as CharacterAlignmentPayload,
      );
    } else if (
      typeof outputMeta?.['transcript'] === 'string' &&
      outputMeta['transcript'].trim().length > 0
    ) {
      alignment = this.estimateWordAlignment(
        outputMeta['transcript'],
        durationMs,
        buffer,
      );
    }

    const extraFiles: ProcessedFileEntry[] = [];
    if (alignment) {
      extraFiles.push({
        role: AssetFileRole.ALIGNMENT,
        fileName: 'alignment.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify(alignment, null, 2), 'utf8'),
        format: 'json',
      });
    }

    return {
      primaryBuffer: buffer,
      mimeType: effectiveMime,
      fileName: effectiveName,
      durationMs,
      sampleRate,
      alignment,
      extraFiles,
    };
  }
}
