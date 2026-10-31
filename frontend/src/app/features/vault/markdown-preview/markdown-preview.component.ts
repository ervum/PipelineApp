import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import DOMPurify from 'dompurify';
import { marked } from 'marked';

function injectHexSwatches(sanitizedHtml: string): string {
  if (typeof document === 'undefined') return sanitizedHtml;
  const container = document.createElement('div');
  container.innerHTML = sanitizedHtml;

  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    const parentTag = current.parentElement?.tagName.toLowerCase();
    if (parentTag !== 'code' && parentTag !== 'pre' && parentTag !== 'script') {
      if (/#[0-9A-Fa-f]{6}\b/.test(current.nodeValue ?? '')) {
        textNodes.push(current as Text);
      }
    }
    current = walker.nextNode();
  }

  const hexRegex = /#[0-9A-Fa-f]{6}\b/g;
  for (const node of textNodes) {
    const text = node.nodeValue ?? '';
    const frag = document.createDocumentFragment();
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    hexRegex.lastIndex = 0;
    while ((match = hexRegex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        frag.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
      }
      const hex = match[0];
      const chip = document.createElement('span');
      chip.className = 'md-swatch';
      chip.style.setProperty('--sw', hex);
      chip.textContent = hex;
      frag.appendChild(chip);
      lastIndex = hexRegex.lastIndex;
    }
    if (lastIndex < text.length) {
      frag.appendChild(document.createTextNode(text.slice(lastIndex)));
    }
    node.parentNode?.replaceChild(frag, node);
  }

  return container.innerHTML;
}

@Component({
  selector: 'fs-markdown-preview',
  standalone: true,
  templateUrl: './markdown-preview.component.html',
  styleUrl: './markdown-preview.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MarkdownPreviewComponent {
  private readonly sanitizer = inject(DomSanitizer);

  readonly content = input.required<string>();

  readonly renderedHtml = computed<SafeHtml>(() => {
    const rawMd = this.content() || '';
    const parsedHtml = marked.parse(rawMd, { gfm: true, async: false }) as string;
    const clean = DOMPurify.sanitize(parsedHtml);
    const withSwatches = injectHexSwatches(clean);
    return this.sanitizer.bypassSecurityTrustHtml(withSwatches);
  });
}
