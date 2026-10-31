import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

const KEYWORDS_BY_LANG: Record<string, ReadonlySet<string>> = {
  LUAU: new Set([
    'local',
    'function',
    'end',
    'if',
    'then',
    'else',
    'elseif',
    'for',
    'in',
    'do',
    'while',
    'repeat',
    'until',
    'return',
    'and',
    'or',
    'not',
    'nil',
    'true',
    'false',
    'export',
    'type',
  ]),
  GDSCRIPT: new Set([
    'func',
    'var',
    'const',
    'extends',
    'class_name',
    'if',
    'elif',
    'else',
    'for',
    'in',
    'while',
    'match',
    'return',
    'pass',
    'true',
    'false',
    'null',
    'self',
    'signal',
    'export',
  ]),
  GLSL: new Set([
    'void',
    'float',
    'vec2',
    'vec3',
    'vec4',
    'mat3',
    'mat4',
    'int',
    'bool',
    'uniform',
    'varying',
    'in',
    'out',
    'inout',
    'sampler2D',
    'if',
    'else',
    'for',
    'while',
    'return',
    'discard',
    'struct',
    'const',
    'true',
    'false',
  ]),
  HLSL: new Set([
    'void',
    'float',
    'float2',
    'float3',
    'float4',
    'float4x4',
    'int',
    'bool',
    'cbuffer',
    'Texture2D',
    'SamplerState',
    'struct',
    'if',
    'else',
    'for',
    'while',
    'return',
    'true',
    'false',
  ]),
  GODOT_SHADER: new Set([
    'shader_type',
    'render_mode',
    'uniform',
    'varying',
    'void',
    'float',
    'vec2',
    'vec3',
    'vec4',
    'mat4',
    'sampler2D',
    'if',
    'else',
    'for',
    'return',
    'true',
    'false',
  ]),
  JSON: new Set(['true', 'false', 'null']),
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function tokenizeLine(line: string, lang: string): string {
  const kwSet = KEYWORDS_BY_LANG[lang.toUpperCase()] ?? KEYWORDS_BY_LANG['LUAU']!;
  const commentPattern =
    lang.toUpperCase() === 'LUAU'
      ? /--.*$/
      : lang.toUpperCase() === 'GDSCRIPT'
        ? /#.*$/
        : /\/\/.*$/;

  const commentMatch = commentPattern.exec(line);
  const codePart = commentMatch ? line.slice(0, commentMatch.index) : line;
  const commentPart = commentMatch ? line.slice(commentMatch.index) : '';

  const tokenRegex =
    /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|\b(\d+(?:\.\d+)?)\b|\b([a-zA-Z_]\w*)(\s*\()?/g;
  let result = '';
  let lastIdx = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(codePart)) !== null) {
    if (match.index > lastIdx) {
      result += escapeHtml(codePart.slice(lastIdx, match.index));
    }
    const [full, strTok, numTok, identTok, parenAfter] = match;
    if (strTok !== undefined) {
      result += `<span class="tok-str">${escapeHtml(strTok)}</span>`;
    } else if (numTok !== undefined) {
      result += `<span class="tok-num">${escapeHtml(numTok)}</span>`;
    } else if (identTok !== undefined) {
      if (kwSet.has(identTok)) {
        result += `<span class="tok-kw">${escapeHtml(identTok)}</span>${escapeHtml(parenAfter ?? '')}`;
      } else if (parenAfter !== undefined) {
        result += `<span class="tok-fn">${escapeHtml(identTok)}</span>${escapeHtml(parenAfter)}`;
      } else {
        result += escapeHtml(full);
      }
    } else {
      result += escapeHtml(full);
    }
    lastIdx = tokenRegex.lastIndex;
  }

  if (lastIdx < codePart.length) {
    result += escapeHtml(codePart.slice(lastIdx));
  }
  if (commentPart) {
    result += `<span class="tok-com">${escapeHtml(commentPart)}</span>`;
  }
  return result;
}

@Component({
  selector: 'fs-code-view',
  standalone: true,
  templateUrl: './code-view.component.html',
  styleUrl: './code-view.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CodeViewComponent {
  private readonly sanitizer = inject(DomSanitizer);

  readonly code = input.required<string>();
  readonly language = input<string>('LUAU');

  readonly tokenizedLines = computed<SafeHtml[]>(() => {
    const rawLines = (this.code() || '').split('\n');
    const lang = this.language();
    return rawLines.map((line) =>
      this.sanitizer.bypassSecurityTrustHtml(tokenizeLine(line, lang)),
    );
  });
}
