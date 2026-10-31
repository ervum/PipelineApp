import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { AssetModel } from '@forge/shared';
import { ButtonComponent } from '../../../../ui/button/button.component';
import { IconComponent } from '../../../../ui/icon/icon.component';
import { ProgressBarComponent } from '../../../../ui/progress-bar/progress-bar.component';
import { SelectComponent, SelectOption } from '../../../../ui/select/select.component';
import { TooltipDirective } from '../../../../ui/tooltip/tooltip.directive';
import { LIGHTING_RIG_OPTIONS, LightingRigId } from '../../engines/lighting-rigs';
import { ModelStats, ModelViewportEngine } from '../../engines/model-viewport.engine';

@Component({
  selector: 'fs-model-viewport',
  standalone: true,
  imports: [
    ButtonComponent,
    IconComponent,
    ProgressBarComponent,
    SelectComponent,
    TooltipDirective,
  ],
  templateUrl: './model-viewport.component.html',
  styleUrl: './model-viewport.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ModelViewportComponent {
  private readonly destroyRef = inject(DestroyRef);

  readonly asset = input<AssetModel | null>(null);
  readonly src = input<string | null>(null);
  readonly format = input<'glb' | 'gltf' | 'obj' | 'fbx'>('glb');
  readonly fileName = input<string | null>(null);
  readonly compact = input<boolean>(false);

  readonly canvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('viewportCanvas');

  readonly wireframe = signal(false);
  readonly showGrid = signal(true);
  readonly autoRotate = signal(false);
  readonly lightingRig = signal<LightingRigId>('studio-3pt');
  readonly loadingProgress = signal<number | null>(null);
  readonly loadError = signal<string | null>(null);
  readonly stats = signal<ModelStats | null>(null);

  readonly rigOptions: ReadonlyArray<SelectOption<LightingRigId>> = LIGHTING_RIG_OPTIONS.map(
    (r) => ({ value: r.id, label: r.label }),
  );

  private engine: ModelViewportEngine | null = null;
  private readonly engineReady = signal(false);

  readonly resolvedUrl = computed(() => {
    const direct = this.src();
    if (direct) return direct;
    const a = this.asset();
    if (!a) return null;
    const modelFile =
      a.files.find((f) => ['glb', 'gltf', 'obj', 'fbx'].includes(f.format.toLowerCase())) ??
      a.files.find((f) => f.role === 'PRIMARY');
    return modelFile?.url ?? a.primaryUrl;
  });

  readonly resolvedDownloadUrl = computed(() => {
    const a = this.asset();
    if (a) {
      const modelFile =
        a.files.find((f) => ['glb', 'gltf', 'obj', 'fbx'].includes(f.format.toLowerCase())) ??
        a.files.find((f) => f.role === 'PRIMARY');
      return modelFile?.downloadUrl ?? a.primaryUrl;
    }
    return this.src();
  });

  readonly resolvedFormat = computed<'glb' | 'gltf' | 'obj' | 'fbx'>(() => {
    const a = this.asset();
    if (a) {
      const modelFile = a.files.find((f) =>
        ['glb', 'gltf', 'obj', 'fbx'].includes(f.format.toLowerCase()),
      );
      const ext = modelFile?.format.toLowerCase();
      if (ext === 'glb' || ext === 'gltf' || ext === 'obj' || ext === 'fbx') {
        return ext;
      }
      if (a.metadata.modality === 'ASSETS_3D') {
        const metaFmt = a.metadata.format.toLowerCase();
        if (metaFmt === 'glb' || metaFmt === 'gltf' || metaFmt === 'obj' || metaFmt === 'fbx') {
          return metaFmt;
        }
      }
    }
    const name = (this.fileName() ?? this.src() ?? '').toLowerCase();
    if (name.endsWith('.obj')) return 'obj';
    if (name.endsWith('.fbx')) return 'fbx';
    if (name.endsWith('.gltf')) return 'gltf';
    return this.format();
  });

  constructor() {
    afterNextRender(() => {
      const canvas = this.canvasRef().nativeElement;
      this.engine = new ModelViewportEngine(canvas, { compact: this.compact() });
      this.engineReady.set(true);
    });

    this.destroyRef.onDestroy(() => {
      this.engine?.dispose();
      this.engine = null;
    });

    effect(() => {
      const ready = this.engineReady();
      const url = this.resolvedUrl();
      const fmt = this.resolvedFormat();
      if (!ready || !url || !this.engine) return;
      untracked(() => {
        void this.loadModel(url, fmt);
      });
    });
  }

  toggleWireframe(): void {
    const next = !this.wireframe();
    this.wireframe.set(next);
    this.engine?.setWireframe(next);
  }

  toggleGrid(): void {
    const next = !this.showGrid();
    this.showGrid.set(next);
    this.engine?.setGrid(next);
  }

  toggleAutoRotate(): void {
    const next = !this.autoRotate();
    this.autoRotate.set(next);
    this.engine?.setAutoRotate(next);
  }

  changeLightingRig(rig: LightingRigId | null): void {
    if (!rig) return;
    this.lightingRig.set(rig);
    this.engine?.setLightingRig(rig);
  }

  resetCamera(): void {
    this.engine?.resetCamera();
  }

  async takeScreenshot(): Promise<void> {
    if (!this.engine) return;
    try {
      const blob = await this.engine.screenshot();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const title = this.asset()?.title ?? this.fileName() ?? 'viewport';
      a.download = `${title.replace(/[^a-zA-Z0-9_-]/g, '_')}_capture.png`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // ignore screenshot failure
    }
  }

  private async loadModel(url: string, fmt: 'glb' | 'gltf' | 'obj' | 'fbx'): Promise<void> {
    if (!this.engine) return;
    this.loadingProgress.set(5);
    this.loadError.set(null);
    try {
      const modelStats = await this.engine.load(url, fmt, (p) => this.loadingProgress.set(p));
      this.stats.set(modelStats);
      this.loadingProgress.set(null);
    } catch (err: unknown) {
      this.loadingProgress.set(null);
      this.loadError.set(err instanceof Error ? err.message : 'Failed to load 3D mesh');
    }
  }
}
