import { ChangeDetectionStrategy, Component, computed, model, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { OtherParams, OtherParamsSchema } from '@forge/shared';
import { ButtonComponent } from '../../../../ui/button/button.component';
import { JsonEditorComponent } from '../../../../ui/json-editor/json-editor.component';
import {
  SegmentedControlComponent,
  SegmentedOption,
} from '../../../../ui/segmented-control/segmented-control.component';
import { SelectComponent, SelectOption } from '../../../../ui/select/select.component';
import { SliderComponent } from '../../../../ui/slider/slider.component';
import { ToggleComponent } from '../../../../ui/toggle/toggle.component';

type SubMode = OtherParams['subMode'];
type SpritesheetParams = OtherParams['spritesheet'];
type VfxParams = OtherParams['vfx'];
type ShaderParams = OtherParams['shader'];
type LoreJsonParams = OtherParams['loreJson'];

@Component({
  selector: 'fs-other-params',
  standalone: true,
  imports: [
    FormsModule,
    ButtonComponent,
    SegmentedControlComponent,
    SelectComponent,
    SliderComponent,
    ToggleComponent,
    JsonEditorComponent,
  ],
  templateUrl: './other-params.component.html',
  styleUrl: './other-params.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OtherParamsComponent {
  readonly params = model.required<OtherParams>();
  readonly seedLocked = signal(false);

  readonly subModeTabs: ReadonlyArray<{ id: SubMode; label: string }> = [
    { id: 'SPRITESHEET', label: 'Spritesheet / Flipbook' },
    { id: 'VFX_TEXTURE', label: 'VFX Texture / Mask' },
    { id: 'SHADER_CODE', label: 'Shader Code' },
    { id: 'LORE_JSON', label: 'Structured Lore/Item JSON' },
  ];

  readonly frameSizeOptions: ReadonlyArray<SegmentedOption<64 | 128 | 256 | 512>> = [
    { value: 64, label: '64 px' },
    { value: 128, label: '128 px' },
    { value: 256, label: '256 px' },
    { value: 512, label: '512 px' },
  ];

  readonly animationTypeOptions: ReadonlyArray<SelectOption<SpritesheetParams['animationType']>> = [
    { value: 'LOOP_FX', label: 'Loop FX' },
    { value: 'IDLE', label: 'Idle Loop' },
    { value: 'WALK', label: 'Walk / Run Cycle' },
    { value: 'ATTACK', label: 'Attack Slash' },
    { value: 'CAST', label: 'Spell Cast' },
    { value: 'EXPLOSION', label: 'Burst / Explosion' },
  ];

  readonly vfxTypeOptions: ReadonlyArray<SelectOption<VfxParams['textureType']>> = [
    { value: 'PARTICLE', label: 'Soft Particle Sprite' },
    { value: 'MASK', label: 'Alpha / Dissolve Mask' },
    { value: 'NOISE', label: 'Procedural Distortion Noise' },
    { value: 'TRAIL', label: 'Ribbon / Weapon Trail' },
    { value: 'FLIPBOOK', label: 'Packed Flipbook Atlas' },
  ];

  readonly vfxResolutionOptions: ReadonlyArray<SegmentedOption<256 | 512 | 1024>> = [
    { value: 256, label: '256 × 256' },
    { value: 512, label: '512 × 512' },
    { value: 1024, label: '1024 × 1024' },
  ];

  readonly shaderLanguageOptions: ReadonlyArray<SelectOption<ShaderParams['language']>> = [
    { value: 'LUAU', label: 'Roblox Luau (VFX / Tween Script)' },
    { value: 'GDSCRIPT', label: 'Godot 4 GDScript' },
    { value: 'GODOT_SHADER', label: 'Godot 4 Shader (.gdshader)' },
    { value: 'HLSL', label: 'DirectX / Unity HLSL (.hlsl)' },
    { value: 'GLSL', label: 'OpenGL / Vulkan GLSL (.glsl)' },
  ];

  readonly targetEngineOptions: ReadonlyArray<SegmentedOption<ShaderParams['targetEngine']>> = [
    { value: 'ROBLOX', label: 'Roblox' },
    { value: 'GODOT', label: 'Godot' },
    { value: 'UNITY', label: 'Unity' },
    { value: 'GENERIC', label: 'Generic' },
  ];

  readonly schemaKindOptions: ReadonlyArray<SelectOption<LoreJsonParams['schemaKind']>> = [
    { value: 'ITEM_TABLE', label: 'Item / Loot Table' },
    { value: 'DIALOGUE_TREE', label: 'Branching Dialogue Tree' },
    { value: 'QUEST', label: 'Quest Chain & Objectives' },
    { value: 'NPC_ROSTER', label: 'NPC Roster & Factions' },
  ];

  readonly customSchemaEnabled = computed(() => this.params().loreJson.customSchema !== null);

  readonly validationErrors = computed<Record<string, string>>(() => {
    const res = OtherParamsSchema.safeParse(this.params());
    if (res.success) return {};
    const out: Record<string, string> = {};
    for (const issue of res.error.issues) {
      const key = issue.path.join('.') || 'root';
      if (!out[key]) out[key] = issue.message;
    }
    return out;
  });

  readonly formatInt = (v: number): string => `${Math.round(v)}`;
  readonly formatFps = (v: number): string => `${Math.round(v)} fps`;

  setSubMode(subMode: SubMode): void {
    this.params.set({ ...this.params(), subMode });
  }

  patchSpritesheet(partial: Partial<SpritesheetParams>): void {
    const cur = this.params();
    this.params.set({
      ...cur,
      spritesheet: { ...cur.spritesheet, ...partial },
    });
  }

  patchVfx(partial: Partial<VfxParams>): void {
    const cur = this.params();
    this.params.set({
      ...cur,
      vfx: { ...cur.vfx, ...partial },
    });
  }

  patchShader(partial: Partial<ShaderParams>): void {
    const cur = this.params();
    this.params.set({
      ...cur,
      shader: { ...cur.shader, ...partial },
    });
  }

  patchLoreJson(partial: Partial<LoreJsonParams>): void {
    const cur = this.params();
    this.params.set({
      ...cur,
      loreJson: { ...cur.loreJson, ...partial },
    });
  }

  toggleCustomSchema(enabled: boolean): void {
    if (enabled) {
      this.patchLoreJson({
        customSchema:
          this.params().loreJson.customSchema ??
          '{\n  "type": "object",\n  "properties": {\n    "items": { "type": "array" }\n  }\n}',
      });
    } else {
      this.patchLoreJson({ customSchema: null });
    }
  }

  rollSeed(): void {
    if (this.seedLocked()) return;
    this.params.set({
      ...this.params(),
      seed: Math.floor(Math.random() * 2_147_483_647),
    });
  }

  onSeedChange(raw: string): void {
    if (this.seedLocked()) return;
    const trimmed = raw.trim();
    if (!trimmed) {
      this.params.set({ ...this.params(), seed: null });
      return;
    }
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed) && parsed >= 0) {
      this.params.set({
        ...this.params(),
        seed: Math.min(2_147_483_647, Math.floor(parsed)),
      });
    }
  }
}
