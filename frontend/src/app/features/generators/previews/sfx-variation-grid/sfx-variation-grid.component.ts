import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  HostListener,
  computed,
  inject,
  input,
  output,
  signal,
  viewChildren,
} from '@angular/core';
import { ApprovalStatus, AssetModel } from '@forge/shared';
import { AssetGalleryStore } from '../../../../core/state/asset-gallery.store';
import { ButtonComponent } from '../../../../ui/button/button.component';
import { IconComponent } from '../../../../ui/icon/icon.component';
import { WaveformPlayerComponent } from '../waveform-player/waveform-player.component';

@Component({
  selector: 'fs-sfx-variation-grid',
  standalone: true,
  imports: [ButtonComponent, IconComponent, WaveformPlayerComponent],
  templateUrl: './sfx-variation-grid.component.html',
  styleUrl: './sfx-variation-grid.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SfxVariationGridComponent {
  private readonly gallery = inject(AssetGalleryStore);
  private readonly destroyRef = inject(DestroyRef);

  readonly asset = input.required<AssetModel>();
  readonly variations = input<ReadonlyArray<AssetModel>>([]);
  readonly selectVariation = output<AssetModel>();

  readonly players = viewChildren(WaveformPlayerComponent);
  readonly playOnHover = signal(false);
  readonly sequentialIndex = signal<number | null>(null);

  private seqTimer: ReturnType<typeof setTimeout> | null = null;

  readonly items = computed<ReadonlyArray<AssetModel>>(() => {
    const list = this.variations();
    return list.length > 0 ? list : [this.asset()];
  });

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.stopSequential();
    });
  }

  @HostListener('document:keydown', ['$event'])
  onKeyDown(event: KeyboardEvent): void {
    const tag = (event.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    if (event.key >= '1' && event.key <= '8' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const idx = Number(event.key) - 1;
      const list = this.items();
      const target = list[idx];
      if (target) {
        event.preventDefault();
        this.auditionIndex(idx);
      }
    } else if (event.key === ' ' && !event.ctrlKey && !event.metaKey) {
      const list = this.items();
      const activeIdx = list.findIndex((v) => v.id === this.asset().id);
      if (activeIdx >= 0) {
        event.preventDefault();
        this.auditionIndex(activeIdx);
      }
    }
  }

  auditionIndex(index: number): void {
    this.stopSequential();
    const list = this.items();
    const item = list[index];
    if (item) {
      this.selectVariation.emit(item);
    }
    const playerList = this.players();
    playerList.forEach((p, i) => {
      if (i !== index) p.stop();
    });
    const targetPlayer = playerList[index];
    if (targetPlayer) {
      targetPlayer.playFrom(0);
    }
  }

  onCardMouseEnter(index: number): void {
    if (!this.playOnHover()) return;
    this.auditionIndex(index);
  }

  togglePlayAllSequential(): void {
    if (this.sequentialIndex() !== null) {
      this.stopSequential();
      return;
    }
    this.playStep(0);
  }

  stopSequential(): void {
    if (this.seqTimer !== null) {
      clearTimeout(this.seqTimer);
      this.seqTimer = null;
    }
    this.sequentialIndex.set(null);
  }

  toggleFavorite(v: AssetModel, event: MouseEvent): void {
    event.stopPropagation();
    void this.gallery.toggleFavorite(v.id);
  }

  toggleApprove(v: AssetModel, event: MouseEvent): void {
    event.stopPropagation();
    const next: ApprovalStatus = v.approval === 'APPROVED' ? 'DRAFT' : 'APPROVED';
    void this.gallery.setApproval(v.id, next);
  }

  private playStep(idx: number): void {
    const list = this.items();
    if (idx >= list.length) {
      this.stopSequential();
      return;
    }
    this.sequentialIndex.set(idx);
    const playerList = this.players();
    playerList.forEach((p, i) => {
      if (i !== idx) p.stop();
    });
    const p = playerList[idx];
    const item = list[idx]!;
    this.selectVariation.emit(item);
    if (p) {
      p.playFrom(0);
    }
    const durMs =
      item.metadata.modality === 'SFX' && item.metadata.durationMs > 0
        ? item.metadata.durationMs
        : Math.max(1200, (p?.duration() ?? 1.5) * 1000);
    this.seqTimer = setTimeout(() => {
      this.playStep(idx + 1);
    }, durMs + 220);
  }
}
