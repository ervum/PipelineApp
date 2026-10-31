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

    return words.length > 0 ? { words } : null;
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
    } else if (durationMs === 0) {
      // Approximate MP3 duration at 128kbps
      durationMs = Math.max(250, Math.round((buffer.length * 8) / 128));
    }

    let alignment: VoiceAlignment | null = null;
    if (
      outputMeta?.['alignment'] &&
      typeof outputMeta['alignment'] === 'object'
    ) {
      alignment = outputMeta['alignment'] as VoiceAlignment;
    } else if (
      outputMeta?.['characterAlignment'] &&
      typeof outputMeta['characterAlignment'] === 'object'
    ) {
      alignment = this.convertCharacterAlignmentToWords(
        outputMeta['characterAlignment'] as CharacterAlignmentPayload,
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
