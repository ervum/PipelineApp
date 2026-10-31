import {
  ChangeDetectionStrategy,
  Component,
  computed,
  model,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LoreParamsSchema, ParamsFor, SEED_MAX } from '@forge/shared';
import { ButtonComponent } from '../../../../ui/button/button.component';
import {
  SegmentedControlComponent,
  SegmentedOption,
} from '../../../../ui/segmented-control/segmented-control.component';
import { SelectComponent, SelectOption } from '../../../../ui/select/select.component';
import { SliderComponent } from '../../../../ui/slider/slider.component';
import { ToggleComponent } from '../../../../ui/toggle/toggle.component';

type LoreLengthForm = ParamsFor<'LORE'>['lengthForm'];
type LoreCategory = ParamsFor<'LORE'>['loreCategory'];
type LoreTone = ParamsFor<'LORE'>['tone'];
type LorePerspective = ParamsFor<'LORE'>['perspective'];
type LoreOutputFormat = ParamsFor<'LORE'>['outputFormat'];

interface LengthFormPreset {
  readonly id: LoreLengthForm;
  readonly label: string;
  readonly rangeLabel: string;
  readonly description: string;
  readonly defaultWords: number;
  readonly defaultIncludeSections: boolean;
}

@Component({
  selector: 'fs-lore-params',
  standalone: true,
  imports: [
    FormsModule,
    ButtonComponent,
    SegmentedControlComponent,
    SelectComponent,
    SliderComponent,
    ToggleComponent,
  ],
  templateUrl: './lore-params.component.html',
  styleUrl: './lore-params.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoreParamsComponent {
  readonly params = model.required<ParamsFor<'LORE'>>();
  readonly seedLocked = signal(false);

  readonly lengthForms: readonly LengthFormPreset[] = [
    {
      id: 'SHORT_FORM',
      label: 'Short-Form',
      rangeLabel: '30 – 150 words',
      description: 'Item tooltip descriptions, weapon flavor text, or skill blurbs',
      defaultWords: 80,
      defaultIncludeSections: false,
    },
    {
      id: 'MEDIUM_FORM',
      label: 'Medium-Form',
      rangeLabel: '200 – 600 words',
      description: 'Bestiary entries, codex pages, location primers, or in-world letters',
      defaultWords: 380,
      defaultIncludeSections: true,
    },
    {
      id: 'LONG_FORM',
      label: 'Long-Form',
      rangeLabel: '700 – 3,000 words',
      description: 'Complete character backstories, faction histories & dialogue scenes',
      defaultWords: 1200,
      defaultIncludeSections: true,
    },
  ];

  readonly categoryOptions: ReadonlyArray<SelectOption<LoreCategory>> = [
    { value: 'ITEM_DESCRIPTION', label: 'Item / Weapon / Artifact Description' },
    { value: 'SKILL_TOOLTIP', label: 'Ability / Spell / Skill Tooltip' },
    { value: 'CHARACTER_BACKSTORY', label: 'Character Backstory & Psychological Profile' },
    { value: 'FACTION_HISTORY', label: 'Faction / Guild / House History' },
    { value: 'WORLD_MYTHOLOGY', label: 'World Mythology & Creation Chronicle' },
    { value: 'LOCATION_CODEX', label: 'Location / Region / Dungeon Codex' },
    { value: 'BESTIARY_ENTRY', label: 'Bestiary / Creature Ecology Entry' },
    { value: 'IN_WORLD_DOCUMENT', label: 'In-World Scroll / Journal / Missive' },
    { value: 'DIALOGUE_SCENE', label: 'Interactive NPC Dialogue Scene' },
  ];

  readonly toneOptions: ReadonlyArray<SelectOption<LoreTone>> = [
    { value: 'IN_WORLD_DIEGETIC', label: 'In-World Diegetic & Atmospheric' },
    { value: 'ENCYCLOPEDIC_CODEX', label: 'Encyclopedic Scholarly Codex' },
    { value: 'POETIC_MYTHIC', label: 'Poetic & Mythic Scripture' },
    { value: 'GRITTY_NOIR', label: 'Gritty Noir & Weathered Chronicle' },
    { value: 'LIGHTHEARTED_COZY', label: 'Lighthearted & Whimsical Folklore' },
    { value: 'CLINICAL_SCI_FI', label: 'Clinical Sci-Fi Tactical Dossier' },
  ];

  readonly perspectiveOptions: ReadonlyArray<SelectOption<LorePerspective>> = [
    { value: 'THIRD_PERSON_OMNISCIENT', label: 'Third-Person Omniscient Narrator' },
    { value: 'FIRST_PERSON_CHRONICLER', label: 'First-Person In-World Chronicler' },
    { value: 'SECOND_PERSON_PLAYER', label: 'Second-Person Player Address ("You…")' },
    { value: 'EPIGRAPH_FRAGMENT', label: 'Recovered Epigraph / Archival Fragment' },
  ];

  readonly outputFormatOptions: ReadonlyArray<SegmentedOption<LoreOutputFormat>> = [
    { value: 'MARKDOWN', label: 'Markdown (.md)' },
    { value: 'PLAIN_TEXT', label: 'Plain Text (.txt)' },
  ];

  readonly formatWords = (v: number): string => `${Math.round(v)} words`;
  readonly formatInt = (v: number): string => `${Math.round(v)}`;

  readonly errors = computed<Record<string, string>>(() => {
    const res = LoreParamsSchema.safeParse(this.params());
    if (res.success) return {};
    const out: Record<string, string> = {};
    for (const issue of res.error.issues) {
      out[issue.path.join('.') || 'root'] = issue.message;
    }
    return out;
  });

  readonly wordSliderRange = computed<{ min: number; max: number; step: number }>(() => {
    const form = this.params().lengthForm;
    if (form === 'SHORT_FORM') {
      return { min: 20, max: 200, step: 10 };
    }
    if (form === 'MEDIUM_FORM') {
      return { min: 150, max: 700, step: 25 };
    }
    return { min: 600, max: 3000, step: 50 };
  });

  patch(partial: Partial<ParamsFor<'LORE'>>): void {
    this.params.update((cur) => ({ ...cur, ...partial }));
  }

  selectLengthForm(preset: LengthFormPreset): void {
    const current = this.params();
    let nextCategory = current.loreCategory;
    if (preset.id === 'SHORT_FORM' && current.loreCategory === 'CHARACTER_BACKSTORY') {
      nextCategory = 'ITEM_DESCRIPTION';
    } else if (preset.id === 'LONG_FORM' && current.loreCategory === 'ITEM_DESCRIPTION') {
      nextCategory = 'CHARACTER_BACKSTORY';
    }
    this.patch({
      lengthForm: preset.id,
      loreCategory: nextCategory,
      targetWordCount: preset.defaultWords,
      includeSections: preset.defaultIncludeSections,
    });
  }

  rollSeed(): void {
    if (this.seedLocked()) return;
    this.patch({ seed: Math.floor(Math.random() * SEED_MAX) });
  }

  onSeedChange(raw: string): void {
    const trimmed = raw.trim();
    if (!trimmed) {
      this.patch({ seed: null });
      return;
    }
    const n = Number.parseInt(trimmed, 10);
    if (!Number.isNaN(n)) {
      this.patch({ seed: Math.max(0, Math.min(SEED_MAX, n)) });
    }
  }
}
