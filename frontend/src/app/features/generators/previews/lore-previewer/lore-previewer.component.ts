import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AssetModel, VaultFolderModel } from '@forge/shared';
import { AssetsApi } from '../../../../core/api/assets.api';
import { VaultApi } from '../../../../core/api/vault.api';
import { StudioStateService } from '../../../../core/state/studio-state.service';
import { ToastService } from '../../../../core/state/toast.service';
import { VaultStateService } from '../../../../core/state/vault-state.service';
import { triggerDownload } from '../../../../core/utils/download';
import { ButtonComponent } from '../../../../ui/button/button.component';
import { CodeViewComponent } from '../../../../ui/code-view/code-view.component';
import { MarkdownPreviewComponent } from '../../../vault/markdown-preview/markdown-preview.component';

interface OutlineHeading {
  readonly level: number;
  readonly text: string;
}

@Component({
  selector: 'fs-lore-previewer',
  standalone: true,
  imports: [FormsModule, ButtonComponent, CodeViewComponent, MarkdownPreviewComponent],
  templateUrl: './lore-previewer.component.html',
  styleUrl: './lore-previewer.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LorePreviewerComponent {
  private readonly toast = inject(ToastService);
  private readonly studio = inject(StudioStateService);
  private readonly vaultState = inject(VaultStateService);
  private readonly vaultApi = inject(VaultApi);
  private readonly assetsApi = inject(AssetsApi);

  readonly asset = input.required<AssetModel>();
  readonly batchAssets = input<ReadonlyArray<AssetModel>>([]);
  readonly selectBatchAsset = output<AssetModel>();

  readonly loreText = signal<string>('');
  readonly loading = signal<boolean>(false);
  readonly savingToVault = signal<boolean>(false);
  readonly savingRevision = signal<boolean>(false);
  readonly viewMode = signal<'READER' | 'SOURCE' | 'EDIT'>('READER');

  readonly loreMeta = computed(() => {
    const m = this.asset().metadata;
    if (m.modality === 'LORE') {
      return m;
    }
    const text = this.loreText();
    const words = text
      .trim()
      .split(/\s+/)
      .filter((w) => w.length > 0).length;
    return {
      modality: 'LORE' as const,
      lengthForm: 'MEDIUM_FORM' as const,
      loreCategory: 'LOCATION_CODEX',
      tone: 'IN_WORLD_DIEGETIC',
      perspective: 'THIRD_PERSON_OMNISCIENT',
      wordCount: words,
      charCount: text.length,
      readingTimeSec: Math.max(5, Math.round((words / 200) * 60)),
      outputFormat: 'MARKDOWN' as const,
      excerpt: text.slice(0, 180),
    };
  });

  readonly wordCount = computed(() => {
    const text = this.loreText().trim();
    if (!text) return this.loreMeta().wordCount;
    return text.split(/\s+/).filter((w) => w.length > 0).length;
  });

  readonly characterCount = computed(() => {
    const text = this.loreText();
    return text ? text.length : this.loreMeta().charCount;
  });

  readonly readingMinutes = computed(() =>
    Math.max(1, Math.ceil(this.wordCount() / 200)),
  );

  readonly headings = computed<ReadonlyArray<OutlineHeading>>(() => {
    const lines = this.loreText().split('\n');
    const out: OutlineHeading[] = [];
    for (const line of lines) {
      const m = /^(#{1,3})\s+(.+)$/.exec(line.trim());
      if (m && m[1] && m[2]) {
        out.push({
          level: m[1].length,
          text: m[2].replace(/[*_`]/g, '').trim(),
        });
      }
    }
    return out;
  });

  constructor() {
    effect(() => {
      const a = this.asset();
      untracked(() => {
        void this.fetchLore(a.primaryUrl);
      });
    });
  }

  copyLore(): void {
    const txt = this.loreText();
    if (!txt || !navigator.clipboard) return;
    void navigator.clipboard.writeText(txt);
    this.toast.success('Copied lore entry to clipboard');
  }

  downloadLore(): void {
    const file = this.asset().files[0];
    const ext = this.loreMeta().outputFormat === 'PLAIN_TEXT' ? '.txt' : '.md';
    const fileName =
      file?.fileName ??
      `${this.asset().title.replace(/[^a-zA-Z0-9_-]/g, '_')}${ext}`;
    triggerDownload(file?.downloadUrl ?? this.asset().primaryUrl, fileName);
  }

  async saveRevision(): Promise<void> {
    const content = this.loreText().trim();
    if (!content || this.savingRevision()) return;
    this.savingRevision.set(true);
    try {
      const revised = await this.assetsApi.revise(this.asset().id, {
        contentText: content,
      });
      this.viewMode.set('READER');
      this.selectBatchAsset.emit(revised);
      this.toast.success(`Saved lore revision v${revised.version}`);
    } catch (err) {
      this.toast.error(
        err instanceof Error ? err.message : 'Failed to save lore revision',
      );
    } finally {
      this.savingRevision.set(false);
    }
  }

  async saveToVault(): Promise<void> {
    const projectId = this.studio.activeProjectId();
    const content = this.loreText().trim();
    if (!projectId || !content || this.savingToVault()) return;

    this.savingToVault.set(true);
    try {
      let root = this.vaultState.tree();
      if (!root) {
        root = await this.vaultApi.getTree(projectId);
      }
      const targetFolderId = this.findLoreFolderId(root) ?? root.id;
      const safeTitle = this.asset()
        .title.replace(/[^a-zA-Z0-9 _-]/g, '')
        .trim()
        .slice(0, 60);
      const ext = this.loreMeta().outputFormat === 'PLAIN_TEXT' ? '.txt' : '.md';
      const fileName = `${safeTitle || 'Generated_Lore'}${ext}`;

      const created = await this.vaultApi.createTextFile(projectId, {
        folderId: targetFolderId,
        name: fileName,
        description: `Generated ${this.loreMeta().lengthForm} lore (${this.loreMeta().loreCategory})`,
        contentText: content,
        scopes: ['LORE', 'ALWAYS_INCLUDE'],
        priority: 75,
      });

      void this.vaultState.loadProject(projectId);
      this.toast.success(`Saved "${created.name}" to Project Vault with @mention support`);
    } catch (err) {
      this.toast.error(
        err instanceof Error ? err.message : 'Failed to save lore entry to Project Vault',
      );
    } finally {
      this.savingToVault.set(false);
    }
  }

  private findLoreFolderId(root: VaultFolderModel | null): string | null {
    if (!root) return null;
    for (const child of root.children ?? []) {
      if (child.name.toLowerCase().includes('lore')) {
        return child.id;
      }
    }
    return root.id;
  }

  private async fetchLore(url: string): Promise<void> {
    this.loading.set(true);
    try {
      const res = await fetch(url);
      const text = res.ok ? await res.text() : '# Failed to load lore document';
      this.loreText.set(text);
    } catch {
      this.loreText.set('# Failed to load lore document');
    } finally {
      this.loading.set(false);
    }
  }
}
