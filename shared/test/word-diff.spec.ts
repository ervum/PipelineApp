import { wordDiff } from '../src';

describe('word-diff', () => {
  it('returns a single equal segment when before and after are identical', () => {
    expect(wordDiff('celestial gold katana', 'celestial gold katana')).toEqual([
      { op: 'equal', text: 'celestial gold katana' },
    ]);
  });

  it('returns empty array when both strings are empty', () => {
    expect(wordDiff('', '')).toEqual([]);
  });

  it('handles pure insertion and pure deletion', () => {
    expect(wordDiff('', 'new prompt')).toEqual([{ op: 'insert', text: 'new prompt' }]);
    expect(wordDiff('old prompt', '')).toEqual([{ op: 'delete', text: 'old prompt' }]);
  });

  it('identifies word-level replacements and merges adjacent same-op tokens', () => {
    const before = 'A sword with blue glow';
    const after = 'A luminous starforged sword with gold glow';
    const diff = wordDiff(before, after);

    const reconstructedBefore = diff
      .filter((d) => d.op !== 'insert')
      .map((d) => d.text)
      .join('');
    const reconstructedAfter = diff
      .filter((d) => d.op !== 'delete')
      .map((d) => d.text)
      .join('');

    expect(reconstructedBefore).toBe(before);
    expect(reconstructedAfter).toBe(after);
    expect(diff.some((d) => d.op === 'insert' && d.text.includes('luminous starforged'))).toBe(
      true,
    );
    expect(diff.some((d) => d.op === 'delete' && d.text === 'blue')).toBe(true);
    expect(diff.some((d) => d.op === 'insert' && d.text === 'gold')).toBe(true);
  });

  it('preserves punctuation tokens accurately during diffing', () => {
    const before = 'subject: sword, style: painterly; glow: cyan.';
    const after = 'subject: sword, style: cel-shaded; glow: gold.';
    const diff = wordDiff(before, after);
    const afterText = diff
      .filter((d) => d.op !== 'delete')
      .map((d) => d.text)
      .join('');
    expect(afterText).toBe(after);
  });

  it('falls back to whole-block replacement when token count exceeds 1500', () => {
    const hugeA = Array.from({ length: 800 }, (_, i) => `wordA${i}`).join(' ');
    const hugeB = Array.from({ length: 800 }, (_, i) => `wordB${i}`).join(' ');
    const diff = wordDiff(hugeA, hugeB);
    expect(diff).toEqual([
      { op: 'delete', text: hugeA },
      { op: 'insert', text: hugeB },
    ]);
  });
});
