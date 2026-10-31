import {
  estimateTokens,
  extractMentions,
  normalizeForMention,
  stripMentions,
  toMentionAlias,
  truncateToTokens,
} from '../src';

describe('mention-parser & token-estimate', () => {
  it('extracts unique lowercase mentions from start of string and after whitespace', () => {
    const text = '@Color-Palette.md Forged sword with @icon-style-guide.md and @COLOR-PALETTE.MD';
    expect(extractMentions(text)).toEqual(['color-palette.md', 'icon-style-guide.md']);
  });

  it('extracts folder-qualified mentions with slashes', () => {
    const text = 'Follow @Art-Direction/Color-Palette.md and @Lore/Characters/Lyra.md';
    expect(extractMentions(text)).toEqual([
      'art-direction/color-palette.md',
      'lore/characters/lyra.md',
    ]);
  });

  it('ignores email addresses where @ is preceded by non-whitespace word characters', () => {
    const text = 'Contact dev@forgestudio.io or use @astra-art-bible.md';
    expect(extractMentions(text)).toEqual(['astra-art-bible.md']);
  });

  it('strips the @ prefix while keeping the mention name in prose', () => {
    const text = '@icon-style-guide.md Create a shield using @Color-Palette.md rules';
    expect(stripMentions(text)).toBe(
      'icon-style-guide.md Create a shield using Color-Palette.md rules',
    );
  });

  it('converts display names to mention aliases and normalizes case', () => {
    expect(toMentionAlias('  Color Palette.md ')).toBe('Color-Palette.md');
    expect(toMentionAlias('Oracle Vesper - Character Sheet.md')).toBe(
      'Oracle-Vesper---Character-Sheet.md',
    );
    expect(normalizeForMention('Color Palette.md')).toBe('color-palette.md');
    expect(normalizeForMention('/Art Direction/Icon Style Guide.md')).toBe(
      '/art-direction/icon-style-guide.md',
    );
  });

  it('estimates tokens at 3.8 chars per token and truncates cleanly at boundaries', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abcd')).toBe(2);
    expect(estimateTokens('a'.repeat(38))).toBe(10);

    const shortText = 'Short paragraph that fits.';
    expect(truncateToTokens(shortText, 50)).toBe(shortText);

    const multiPara = `${'First paragraph line.\n'.repeat(10)}\n\n${'Second paragraph line.\n'.repeat(20)}`;
    const truncated = truncateToTokens(multiPara, 80);
    expect(truncated.endsWith('\n…[truncated]')).toBe(true);
    expect(truncated.length).toBeLessThan(multiPara.length);
  });
});
