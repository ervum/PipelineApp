import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { AssetModel } from '@forge/shared';
import { ToastService } from '../../../../core/state/toast.service';
import { triggerDownload } from '../../../../core/utils/download';
import { ButtonComponent } from '../../../../ui/button/button.component';
import { CodeViewComponent } from '../../../../ui/code-view/code-view.component';
import { IconComponent } from '../../../../ui/icon/icon.component';

@Component({
  selector: 'fs-code-preview',
  standalone: true,
  imports: [ButtonComponent, CodeViewComponent, IconComponent],
  templateUrl: './code-preview.component.html',
  styleUrl: './code-preview.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CodePreviewComponent {
  private readonly toast = inject(ToastService);

  readonly asset = input.required<AssetModel>();
  readonly codeText = signal<string>('');
  readonly loading = signal(false);

  readonly language = computed(() => {
    const m = this.asset().metadata;
    if (m.modality === 'OTHER' && m.language) {
      return m.language;
    }
    const ext = (this.asset().files[0]?.format ?? '').toLowerCase();
    if (ext === 'gd') return 'GDSCRIPT';
    if (ext === 'gdshader') return 'GODOT_SHADER';
    if (ext === 'hlsl') return 'HLSL';
    if (ext === 'glsl') return 'GLSL';
    return 'LUAU';
  });

  readonly extension = computed(() => {
    const lang = this.language();
    switch (lang) {
      case 'GDSCRIPT':
        return '.gd';
      case 'GODOT_SHADER':
        return '.gdshader';
      case 'HLSL':
        return '.hlsl';
      case 'GLSL':
        return '.glsl';
      default:
        return '.luau';
    }
  });

  readonly lineCount = computed(() => {
    const c = this.codeText();
    return c ? c.split('\n').length : 0;
  });

  constructor() {
    effect(() => {
      const a = this.asset();
      untracked(() => {
        void this.fetchCode(a.primaryUrl);
      });
    });
  }

  copyCode(): void {
    const txt = this.codeText();
    if (!txt || !navigator.clipboard) return;
    void navigator.clipboard.writeText(txt);
    this.toast.success('Copied shader / script code to clipboard');
  }

  downloadCode(): void {
    const file = this.asset().files[0];
    const fileName =
      file?.fileName ??
      `${this.asset().title.replace(/[^a-zA-Z0-9_-]/g, '_')}${this.extension()}`;
    triggerDownload(file?.downloadUrl ?? this.asset().primaryUrl, fileName);
  }

  private async fetchCode(url: string): Promise<void> {
    this.loading.set(true);
    try {
      const res = await fetch(url);
      const text = res.ok ? await res.text() : '// Failed to load script source';
      this.codeText.set(text);
    } catch {
      this.codeText.set('// Failed to load script source');
    } finally {
      this.loading.set(false);
    }
  }
}
