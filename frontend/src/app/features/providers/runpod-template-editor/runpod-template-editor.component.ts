import {
  ChangeDetectionStrategy,
  Component,
  computed,
  model,
  signal,
  viewChild,
} from '@angular/core';
import { InterpolationResult, TEMPLATE_VARIABLES, interpolateTemplate } from '@forge/shared';
import { CodeViewComponent } from '../../../ui/code-view/code-view.component';
import { JsonEditorComponent } from '../../../ui/json-editor/json-editor.component';

function tryParseObject(
  text: string,
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  try {
    const val: unknown = JSON.parse(text);
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      return { ok: true, value: val as Record<string, unknown> };
    }
    return { ok: false, error: 'Root must be a JSON object' };
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : 'Invalid JSON' };
  }
}

const DEFAULT_SAMPLE_VARS: Record<string, unknown> = {
  enhanced_prompt:
    'Ornate obsidian katana with glowing cyan aether runes along the fuller, centered die-cut icon',
  negative_prompt: 'blurry, watermark, text, noisy background, cropped',
  raw_prompt: 'fire katana icon',
  seed: 1234,
  width: 1024,
  height: 1024,
  aspect_ratio: '1:1',
  steps: 28,
  cfg_scale: 6.5,
  batch_count: 1,
  duration_seconds: 60,
  bpm: 128,
  key_signature: 'D minor',
  loop: true,
  voice_id: 'voice_lyra_01',
  transcript: 'Hold the perimeter until the aether core stabilizes!',
  speed: 1.0,
  stability: 0.55,
  target_polycount: 5000,
  texture_resolution: 2048,
  output_format: 'glb',
  model: 'flux-1-dev',
  job_id: 'job_sample_01',
  project_slug: 'astra-crystal-odyssey',
  params: {
    iconCategory: 'ITEM',
    frameShape: 'HEXAGON',
  },
};

@Component({
  selector: 'fs-runpod-template-editor',
  standalone: true,
  imports: [JsonEditorComponent, CodeViewComponent],
  templateUrl: './runpod-template-editor.component.html',
  styleUrl: './runpod-template-editor.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RunPodTemplateEditorComponent {
  readonly templateText = model<string>(
    JSON.stringify(
      {
        input: {
          prompt: '{{enhanced_prompt}}',
          negative_prompt: '{{negative_prompt}}',
          width: '{{width}}',
          height: '{{height}}',
          num_inference_steps: '{{steps}}',
          guidance_scale: '{{cfg_scale}}',
          seed: '{{seed}}',
        },
      },
      null,
      2,
    ),
  );

  readonly sampleVarsText = signal<string>(JSON.stringify(DEFAULT_SAMPLE_VARS, null, 2));
  readonly showVarsEditor = signal<boolean>(false);

  readonly templateEditor = viewChild<JsonEditorComponent>('tplEditor');

  readonly variableChips: ReadonlyArray<string> = [
    ...TEMPLATE_VARIABLES,
    'params.iconCategory',
    'params.frameShape',
  ];

  readonly parsed = computed(() => tryParseObject(this.templateText()));

  readonly sampleVars = computed<Record<string, unknown>>(() => {
    const p = tryParseObject(this.sampleVarsText());
    return p.ok ? p.value : DEFAULT_SAMPLE_VARS;
  });

  readonly preview = computed<InterpolationResult | null>(() => {
    const p = this.parsed();
    if (!p.ok) return null;
    return interpolateTemplate(p.value, this.sampleVars());
  });

  readonly previewJson = computed(() => {
    const res = this.preview();
    if (!res) return '// Fix template JSON errors to preview interpolation';
    return JSON.stringify(res.value, null, 2);
  });

  insertVariable(varName: string): void {
    this.templateEditor()?.insertAtCaret(`{{${varName}}}`);
  }
}
