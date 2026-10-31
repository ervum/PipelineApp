import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  ApprovalStatus,
  AssetFileRole,
  AssetModel,
  ContextScope,
  CreateJobDto,
  defaultParamsFor,
  ErrorCode,
  ExecutionMode,
  JobStatus,
  McpContentBlock,
  McpInvocationLogEntry,
  McpPromptDefinition,
  McpResourceDefinition,
  McpServerStatusModel,
  McpToolCallResult,
  McpToolDefinition,
  MODALITIES,
  Modality,
  ModalityParams,
  ModalityParamsSchema,
  normalizeForMention,
  ProviderKind,
  TERMINAL_JOB_STATUSES,
} from '@forge/shared';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { AssetsService } from '../assets/assets.service';
import { DomainError } from '../common/errors/domain.error';
import { sleep } from '../common/utils/sleep';
import { JobsService } from '../generators/jobs.service';
import { MiddlemanCompilerService } from '../middleman/middleman-compiler.service';
import {
  JOB_EVENTS_PUBLISHER,
  JobEventsPublisherPort,
} from '../orchestrator/job-events.port';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsService } from '../projects-vault/projects.service';
import { VaultFilesService } from '../projects-vault/vault-files.service';
import { VoiceProfilesService } from '../projects-vault/voice-profiles.service';
import { ProvidersService } from '../providers/providers.service';
import { StorageService } from '../storage/storage.service';

const MAX_LOG_ENTRIES = 100;
const MAX_DB_LOG_ROWS = 1000;

@Injectable()
export class McpToolsService {
  private readonly logs: McpInvocationLogEntry[] = [];
  private totalInvocations = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobsService: JobsService,
    private readonly assetsService: AssetsService,
    private readonly projectsService: ProjectsService,
    private readonly vaultFilesService: VaultFilesService,
    private readonly voiceProfilesService: VoiceProfilesService,
    private readonly middlemanCompiler: MiddlemanCompilerService,
    private readonly providersService: ProvidersService,
    private readonly storage: StorageService,
    @Optional()
    @Inject(JOB_EVENTS_PUBLISHER)
    private readonly events?: JobEventsPublisherPort,
  ) {}

  getTools(): McpToolDefinition[] {
    return [
      {
        name: 'forge_generate_2d_icon',
        title: 'Generate 2D Game Icon',
        category: 'GENERATION',
        modality: Modality.ICONS_2D,
        description:
          'Prompts the ForgeStudio 2D Icon Generator (ICONS_2D) using Project Vault context and the LLM Middleman Compiler, awaits completion, and returns the generated PNG icon (inline base64 image block, download URLs for 1024/512/128/64/32 variants, and optional direct file export to exportToPath).',
        inputSchema: {
          type: 'object',
          required: ['prompt'],
          properties: {
            prompt: {
              type: 'string',
              description:
                'Creative prompt for the 2D icon (supports @mentions of Project Vault files, e.g. "Astral frost dagger icon @palette").',
            },
            projectId: {
              type: 'string',
              description: 'Optional Project ID. Defaults to the active/primary project.',
            },
            iconCategory: {
              type: 'string',
              enum: ['ITEM', 'SKILL', 'RANK_EMBLEM', 'UI_BUTTON'],
              default: 'ITEM',
              description: 'Icon category.',
            },
            frameShape: {
              type: 'string',
              enum: ['NONE', 'CIRCLE', 'ROUNDED_SQUARE', 'HEXAGON', 'SHIELD', 'DIAMOND'],
              default: 'NONE',
              description: 'Optional die-cut UI frame border.',
            },
            removeBackground: {
              type: 'boolean',
              default: true,
              description: 'Produce a transparent alpha channel background.',
            },
            outputSize: {
              type: 'integer',
              enum: [512, 1024],
              default: 1024,
              description: 'Master icon resolution in pixels.',
            },
            batchCount: {
              type: 'integer',
              minimum: 1,
              maximum: 4,
              default: 1,
              description: 'Number of icon variations to generate.',
            },
            skipMiddleman: {
              type: 'boolean',
              default: false,
              description: 'Skip LLM Middleman compilation and use raw prompt directly.',
            },
            exportToPath: {
              type: 'string',
              description:
                'Optional local filesystem path where the generated primary PNG icon will be copied immediately upon completion.',
            },
            waitForCompletion: {
              type: 'boolean',
              default: true,
              description: 'Wait for generation to finish and return the completed asset.',
            },
          },
        },
        sampleArgs: {
          prompt: 'Starforged astral potion vial glowing with violet nebula runes',
          iconCategory: 'ITEM',
          frameShape: 'ROUNDED_SQUARE',
          removeBackground: true,
          outputSize: 1024,
          batchCount: 1,
          waitForCompletion: true,
        },
      },
      {
        name: 'forge_generate_3d_asset',
        title: 'Generate 3D Mesh Asset (.glb)',
        category: 'GENERATION',
        modality: Modality.ASSETS_3D,
        description:
          'Prompts the 3D Asset Generator (ASSETS_3D — TEXT_TO_3D or IMAGE_TO_3D), awaits completion, and returns the generated .glb mesh URL, vertex/triangle stats, thumbnail image block, and optional direct file export.',
        inputSchema: {
          type: 'object',
          required: ['prompt'],
          properties: {
            prompt: {
              type: 'string',
              description: 'Prompt describing the 3D prop, weapon, environment piece, or character.',
            },
            projectId: {
              type: 'string',
              description: 'Optional Project ID.',
            },
            subMode: {
              type: 'string',
              enum: ['TEXT_TO_3D', 'IMAGE_TO_3D'],
              default: 'TEXT_TO_3D',
              description: '3D generation mode.',
            },
            assetCategory: {
              type: 'string',
              enum: ['PROP', 'WEAPON', 'ENVIRONMENT', 'CHARACTER_BASE'],
              default: 'WEAPON',
              description: '3D asset archetype.',
            },
            polycountTier: {
              type: 'string',
              enum: ['LOW_POLY', 'MID_POLY', 'HIGH_RES'],
              default: 'LOW_POLY',
              description: 'Triangle budget tier.',
            },
            pose: {
              type: 'string',
              enum: ['NONE', 'T_POSE', 'A_POSE'],
              default: 'NONE',
              description: 'Character rig pose.',
            },
            enablePbr: {
              type: 'boolean',
              default: true,
              description: 'Generate PBR metallic/roughness materials.',
            },
            exportToPath: {
              type: 'string',
              description: 'Optional local filesystem path to save the .glb mesh file.',
            },
            waitForCompletion: {
              type: 'boolean',
              default: true,
              description: 'Await completion and return the finished 3D asset.',
            },
          },
        },
        sampleArgs: {
          prompt: 'Celestial astrolabe greatsword with gold filigree hilt',
          assetCategory: 'WEAPON',
          polycountTier: 'LOW_POLY',
          enablePbr: true,
          waitForCompletion: true,
        },
      },
      {
        name: 'forge_generate_image',
        title: 'Generate Concept Art or Seamless Texture',
        category: 'GENERATION',
        modality: Modality.IMAGES,
        description:
          'Prompts the Images Generator (IMAGES) for concept art, splash art, thumbnails, or seamless tileable PBR textures, returning the generated image inline and as downloadable URLs.',
        inputSchema: {
          type: 'object',
          required: ['prompt'],
          properties: {
            prompt: {
              type: 'string',
              description: 'Visual prompt for the image or texture.',
            },
            projectId: {
              type: 'string',
              description: 'Optional Project ID.',
            },
            imageCategory: {
              type: 'string',
              enum: ['THUMBNAIL', 'CONCEPT_ART', 'PBR_TEXTURE', 'BACKGROUND', 'SPLASH_ART'],
              default: 'CONCEPT_ART',
              description: 'Image category.',
            },
            aspectPreset: {
              type: 'string',
              enum: ['SQUARE_1_1', 'THUMB_16_9', 'PORTRAIT_9_16', 'SEAMLESS_TILE'],
              default: 'THUMB_16_9',
              description: 'Aspect ratio or seamless tile preset.',
            },
            batchCount: {
              type: 'integer',
              minimum: 1,
              maximum: 4,
              default: 1,
              description: 'Number of variations.',
            },
            exportToPath: {
              type: 'string',
              description: 'Optional local file path to write the generated PNG.',
            },
            waitForCompletion: {
              type: 'boolean',
              default: true,
              description: 'Wait for completion.',
            },
          },
        },
        sampleArgs: {
          prompt: 'High observatory of House Lyra beneath a shattered violet nebula sky',
          imageCategory: 'CONCEPT_ART',
          aspectPreset: 'THUMB_16_9',
          waitForCompletion: true,
        },
      },
      {
        name: 'forge_generate_video',
        title: 'Generate Cinematic Video Clip or VFX Loop',
        category: 'GENERATION',
        modality: Modality.VIDEO,
        description:
          'Prompts the Video Generator (VIDEO — TEXT_TO_VIDEO or IMAGE_TO_VIDEO) with camera motion controls and 32GB DDR5 RAM offload support, returning the generated animated clip, poster frame, and keyframe sequence.',
        inputSchema: {
          type: 'object',
          required: ['prompt'],
          properties: {
            prompt: {
              type: 'string',
              description: 'Prompt describing scene motion, lighting, and camera action.',
            },
            projectId: {
              type: 'string',
              description: 'Optional Project ID.',
            },
            subMode: {
              type: 'string',
              enum: ['TEXT_TO_VIDEO', 'IMAGE_TO_VIDEO'],
              default: 'TEXT_TO_VIDEO',
              description: 'Video synthesis mode.',
            },
            videoCategory: {
              type: 'string',
              enum: [
                'CUTSCENE',
                'VFX_LOOP',
                'CHARACTER_TURNTABLE',
                'ENVIRONMENT_PAN',
                'TRAILER_SHOT',
                'UI_ANIMATION',
              ],
              default: 'CUTSCENE',
              description: 'Video shot category.',
            },
            durationSec: {
              type: 'number',
              minimum: 2,
              maximum: 16,
              default: 5,
              description: 'Duration in seconds.',
            },
            fps: {
              type: 'integer',
              enum: [24, 30, 60],
              default: 24,
              description: 'Frame rate.',
            },
            aspectRatio: {
              type: 'string',
              enum: ['16:9', '9:16', '1:1', '21:9'],
              default: '16:9',
              description: 'Video aspect ratio.',
            },
            cameraMotion: {
              type: 'string',
              enum: [
                'STATIC',
                'PAN_LEFT',
                'PAN_RIGHT',
                'TILT_UP',
                'TILT_DOWN',
                'ZOOM_IN',
                'ZOOM_OUT',
                'ORBIT',
                'DOLLY_TRACK',
              ],
              default: 'ORBIT',
              description: 'Camera movement trajectory.',
            },
            loopable: {
              type: 'boolean',
              default: true,
              description: 'Generate a seamless loop.',
            },
            memoryStrategy: {
              type: 'string',
              enum: ['AUTO', 'RAM_FALLBACK_32GB', 'LOW_VRAM_TILED', 'VRAM_ONLY'],
              default: 'RAM_FALLBACK_32GB',
              description:
                'Memory strategy (RAM_FALLBACK_32GB uses 32GB DDR5 system RAM as fallback when GPU VRAM fills up).',
            },
            exportToPath: {
              type: 'string',
              description: 'Optional local file path to export the generated video clip.',
            },
            waitForCompletion: {
              type: 'boolean',
              default: true,
              description: 'Wait for completion.',
            },
          },
        },
        sampleArgs: {
          prompt: 'Slow orbital camera around the Astral Spire as golden starlight rings rotate',
          videoCategory: 'ENVIRONMENT_PAN',
          cameraMotion: 'ORBIT',
          durationSec: 5,
          fps: 24,
          aspectRatio: '16:9',
          loopable: true,
          memoryStrategy: 'RAM_FALLBACK_32GB',
          waitForCompletion: true,
        },
      },
      {
        name: 'forge_generate_lore',
        title: 'Generate Short-Form or Long-Form Game Lore',
        category: 'GENERATION',
        modality: Modality.LORE,
        description:
          'Prompts the Lore & Narrative Generator (LORE) for short-form item descriptions & tooltips, medium-form codex entries, or long-form multi-chapter character backstories & world histories. Returns the full Markdown/text inline and optionally promotes it into the Project Vault.',
        inputSchema: {
          type: 'object',
          required: ['prompt'],
          properties: {
            prompt: {
              type: 'string',
              description:
                'Narrative prompt (e.g. "Item description for the Starforged Dagger" or "Complete backstory of Commander Lyra Vance").',
            },
            projectId: {
              type: 'string',
              description: 'Optional Project ID.',
            },
            lengthForm: {
              type: 'string',
              enum: ['SHORT_FORM', 'MEDIUM_FORM', 'LONG_FORM'],
              default: 'SHORT_FORM',
              description:
                'SHORT_FORM (~50-150w item tooltip/flavor), MEDIUM_FORM (~250-500w codex/bestiary), LONG_FORM (~800-2500w full character backstory/chronicle).',
            },
            loreCategory: {
              type: 'string',
              enum: [
                'ITEM_DESCRIPTION',
                'SKILL_TOOLTIP',
                'CHARACTER_BACKSTORY',
                'FACTION_HISTORY',
                'WORLD_MYTHOLOGY',
                'LOCATION_CODEX',
                'BESTIARY_ENTRY',
                'IN_WORLD_DOCUMENT',
                'DIALOGUE_SCENE',
              ],
              default: 'ITEM_DESCRIPTION',
              description: 'Narrative category.',
            },
            tone: {
              type: 'string',
              enum: [
                'IN_WORLD_DIEGETIC',
                'ENCYCLOPEDIC_CODEX',
                'POETIC_MYTHIC',
                'GRITTY_NOIR',
                'LIGHTHEARTED_COZY',
                'CLINICAL_SCI_FI',
              ],
              default: 'IN_WORLD_DIEGETIC',
              description: 'Literary tone.',
            },
            perspective: {
              type: 'string',
              enum: [
                'THIRD_PERSON_OMNISCIENT',
                'FIRST_PERSON_CHRONICLER',
                'SECOND_PERSON_PLAYER',
                'EPIGRAPH_FRAGMENT',
              ],
              default: 'THIRD_PERSON_OMNISCIENT',
              description: 'Narrative point of view.',
            },
            targetWordCount: {
              type: 'integer',
              minimum: 20,
              maximum: 3000,
              default: 120,
              description: 'Target word count.',
            },
            includeSections: {
              type: 'boolean',
              default: true,
              description: 'Include structured Markdown headings, epigraph, and narrative hooks.',
            },
            saveToVault: {
              type: 'boolean',
              default: false,
              description:
                'Automatically save the generated lore document into the Project Vault Root folder as a Markdown file.',
            },
            exportToPath: {
              type: 'string',
              description: 'Optional local filesystem path to write the .md/.txt file.',
            },
          },
        },
        sampleArgs: {
          prompt: 'Entire character backstory of Archivist Seraphina, exile of House Lyra',
          lengthForm: 'LONG_FORM',
          loreCategory: 'CHARACTER_BACKSTORY',
          tone: 'POETIC_MYTHIC',
          targetWordCount: 900,
          includeSections: true,
          saveToVault: false,
        },
      },
      {
        name: 'forge_generate_music',
        title: 'Generate Game Music & Stems',
        category: 'GENERATION',
        modality: Modality.MUSIC,
        description:
          'Prompts the Music Generator (MUSIC) for loopable BGM, combat tracks, or ambient cues with optional stem separation (drums, bass, harmony, lead).',
        inputSchema: {
          type: 'object',
          required: ['prompt'],
          properties: {
            prompt: {
              type: 'string',
              description: 'Musical direction prompt.',
            },
            projectId: { type: 'string', description: 'Optional Project ID.' },
            trackType: {
              type: 'string',
              enum: ['BGM_LOOP', 'COMBAT', 'AMBIENT', 'STINGER', 'MENU'],
              default: 'BGM_LOOP',
              description: 'Track category.',
            },
            durationSec: {
              type: 'number',
              minimum: 5,
              maximum: 300,
              default: 20,
              description: 'Duration in seconds.',
            },
            bpm: {
              type: 'integer',
              minimum: 40,
              maximum: 220,
              default: 112,
              description: 'Tempo in beats per minute.',
            },
            keySignature: {
              type: 'string',
              default: 'D Dorian',
              description: 'Musical key signature.',
            },
            seamlessLoop: {
              type: 'boolean',
              default: true,
              description: 'Seamless loop cadence.',
            },
            generateStems: {
              type: 'boolean',
              default: true,
              description: 'Generate isolated stems alongside the master mix.',
            },
            exportToPath: {
              type: 'string',
              description: 'Optional local path to save the master WAV.',
            },
          },
        },
        sampleArgs: {
          prompt: 'Ethereal observatory exploration theme with celesta, cello, and warm analog pad',
          trackType: 'BGM_LOOP',
          durationSec: 15,
          bpm: 108,
          keySignature: 'D Dorian',
          seamlessLoop: true,
          generateStems: true,
        },
      },
      {
        name: 'forge_generate_voice',
        title: 'Generate Character Voice & Dialogue',
        category: 'GENERATION',
        modality: Modality.VOICES,
        description:
          'Synthesizes character voice dialogue, barks, or narration (VOICES) with word-level alignment timestamps.',
        inputSchema: {
          type: 'object',
          required: ['transcript'],
          properties: {
            transcript: {
              type: 'string',
              description: 'Exact spoken line of dialogue.',
            },
            prompt: {
              type: 'string',
              description: 'Acting direction and emotional context.',
            },
            projectId: { type: 'string', description: 'Optional Project ID.' },
            voiceProfileId: {
              type: 'string',
              description: 'Optional Voice Profile ID from the project.',
            },
            lineType: {
              type: 'string',
              enum: ['DIALOGUE', 'BARK', 'NARRATION'],
              default: 'DIALOGUE',
              description: 'Voice line type.',
            },
            speed: {
              type: 'number',
              minimum: 0.7,
              maximum: 1.3,
              default: 1.0,
              description: 'Delivery speed multiplier.',
            },
            exportToPath: {
              type: 'string',
              description: 'Optional local path to save the synthesized WAV.',
            },
          },
        },
        sampleArgs: {
          transcript: 'Every star above Aethelgard remembers the oath we broke.',
          prompt: 'Measured, solemn, resonant delivery in a vaulted stone hall',
          lineType: 'DIALOGUE',
          speed: 1.0,
        },
      },
      {
        name: 'forge_generate_sfx',
        title: 'Generate Sound Effects (SFX)',
        category: 'GENERATION',
        modality: Modality.SFX,
        description:
          'Prompts the Sound Effects Generator (SFX) for weapon hits, UI clicks, footsteps, magic bursts, or explosions, returning 1-8 variations.',
        inputSchema: {
          type: 'object',
          required: ['prompt'],
          properties: {
            prompt: {
              type: 'string',
              description: 'Foley and acoustic description of the sound effect.',
            },
            projectId: { type: 'string', description: 'Optional Project ID.' },
            sfxCategory: {
              type: 'string',
              enum: [
                'WEAPON_HIT',
                'UI_CLICK',
                'FOOTSTEP',
                'MAGIC',
                'AMBIENT_FOLEY',
                'EXPLOSION',
                'CREATURE',
                'IMPACT',
              ],
              default: 'MAGIC',
              description: 'SFX category.',
            },
            durationSec: {
              type: 'number',
              minimum: 0.5,
              maximum: 22,
              default: 1.8,
              description: 'Duration in seconds.',
            },
            variationCount: {
              type: 'integer',
              minimum: 1,
              maximum: 8,
              default: 3,
              description: 'Number of variations to synthesize.',
            },
            exportToPath: {
              type: 'string',
              description: 'Optional local path to save variation #1 WAV.',
            },
          },
        },
        sampleArgs: {
          prompt: 'Crystalline astral rune activation chime with sub-bass shimmer',
          sfxCategory: 'MAGIC',
          durationSec: 1.8,
          variationCount: 2,
        },
      },
      {
        name: 'forge_generate_code_or_sprite',
        title: 'Generate Shaders, Lore JSON, or Spritesheets',
        category: 'GENERATION',
        modality: Modality.OTHER,
        description:
          'Prompts the Specialized Generator (OTHER) for SHADER_CODE (Luau/GLSL/HLSL/Godot), LORE_JSON (structured item/quest/dialogue tables), or SPRITESHEET (2D animation frames).',
        inputSchema: {
          type: 'object',
          required: ['prompt', 'subMode'],
          properties: {
            prompt: {
              type: 'string',
              description: 'Engineering or visual specification.',
            },
            projectId: { type: 'string', description: 'Optional Project ID.' },
            subMode: {
              type: 'string',
              enum: ['SPRITESHEET', 'VFX_TEXTURE', 'SHADER_CODE', 'LORE_JSON'],
              default: 'SHADER_CODE',
              description: 'Sub-mode to execute.',
            },
            shaderLanguage: {
              type: 'string',
              enum: ['LUAU', 'GDSCRIPT', 'GODOT_SHADER', 'HLSL', 'GLSL'],
              default: 'GLSL',
              description: 'Target language when subMode=SHADER_CODE.',
            },
            schemaKind: {
              type: 'string',
              enum: ['ITEM_TABLE', 'DIALOGUE_TREE', 'QUEST', 'NPC_ROSTER'],
              default: 'ITEM_TABLE',
              description: 'Schema kind when subMode=LORE_JSON.',
            },
            exportToPath: {
              type: 'string',
              description: 'Optional local filesystem path to save the output.',
            },
          },
        },
        sampleArgs: {
          prompt: 'Pulsing astral shield shader with hexagonal fresnel rim glow',
          subMode: 'SHADER_CODE',
          shaderLanguage: 'GODOT_SHADER',
        },
      },
      {
        name: 'forge_generate_asset',
        title: 'Universal Polymorphic Asset Generator',
        category: 'GENERATION',
        modality: null,
        description:
          'Universal generation tool accepting any Modality (ICONS_2D, ASSETS_3D, IMAGES, VIDEO, LORE, MUSIC, VOICES, SFX, OTHER) and full modality params.',
        inputSchema: {
          type: 'object',
          required: ['modality', 'prompt'],
          properties: {
            modality: {
              type: 'string',
              enum: [...MODALITIES],
              description: 'Target modality.',
            },
            prompt: {
              type: 'string',
              description: 'Creative prompt.',
            },
            projectId: { type: 'string', description: 'Optional Project ID.' },
            providerConfigId: { type: 'string', description: 'Optional Provider Config ID.' },
            params: {
              type: 'object',
              description: 'Modality-specific parameter overrides.',
            },
            advanced: {
              type: 'object',
              description: 'Adapter-level ParamSpec overrides.',
            },
            skipMiddleman: {
              type: 'boolean',
              default: false,
              description: 'Skip Middleman prompt compilation.',
            },
            exportToPath: {
              type: 'string',
              description: 'Optional local path to export the primary generated file.',
            },
          },
        },
        sampleArgs: {
          modality: 'ICONS_2D',
          prompt: 'Golden sun-crest shield emblem',
          params: { frameShape: 'SHIELD', removeBackground: true },
        },
      },
      {
        name: 'forge_compile_prompt',
        title: 'Compile Prompt via LLM Middleman',
        category: 'MIDDLEMAN',
        modality: null,
        description:
          'Statelessly runs the ForgeStudio LLM Middleman Prompt Compiler with Project Vault context (@mentions and auto-scoped files) and returns the enhancedPrompt, negativePrompt, recommendedParams, and contextSourcesUsed without creating a generation job.',
        inputSchema: {
          type: 'object',
          required: ['modality', 'prompt'],
          properties: {
            modality: {
              type: 'string',
              enum: [...MODALITIES],
              description: 'Target modality for compilation.',
            },
            prompt: {
              type: 'string',
              description: 'Raw user prompt (supports @mentions).',
            },
            projectId: { type: 'string', description: 'Optional Project ID.' },
          },
        },
        sampleArgs: {
          modality: 'ICONS_2D',
          prompt: 'Relic dagger of House Lyra',
        },
      },
      {
        name: 'forge_preview_vault_context',
        title: 'Preview Vault Context & Token Budget',
        category: 'MIDDLEMAN',
        modality: null,
        description:
          'Inspects which Project Vault files (@mentions, ALWAYS_INCLUDE, and modality-scoped files) will be injected into the Middleman compiler for a given prompt and modality.',
        inputSchema: {
          type: 'object',
          required: ['modality'],
          properties: {
            modality: {
              type: 'string',
              enum: [...MODALITIES],
              description: 'Target modality.',
            },
            prompt: {
              type: 'string',
              description: 'Optional raw prompt containing @mentions.',
            },
            projectId: { type: 'string', description: 'Optional Project ID.' },
          },
        },
        sampleArgs: {
          modality: 'LORE',
          prompt: 'Chronicle of the Shattered Veil',
        },
      },
      {
        name: 'forge_list_projects',
        title: 'List Projects',
        category: 'VAULT',
        modality: null,
        description:
          'Lists all active creative projects in ForgeStudio with their slug, genre, accent color, global canon summary, and vault/asset counts.',
        inputSchema: {
          type: 'object',
          properties: {
            includeArchived: {
              type: 'boolean',
              default: false,
              description: 'Include archived projects.',
            },
          },
        },
        sampleArgs: { includeArchived: false },
      },
      {
        name: 'forge_create_project',
        title: 'Create New Project',
        category: 'VAULT',
        modality: null,
        description:
          'Creates a new project with its own Project Vault root folder, genre, accent hex color, and global canon summary.',
        inputSchema: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string', description: 'Project title.' },
            tagline: { type: 'string', description: 'Short tagline.' },
            genre: { type: 'string', description: 'Game/project genre.' },
            accentHex: { type: 'string', default: '#7C3AED', description: 'Hex accent color.' },
            globalSummary: {
              type: 'string',
              description: 'Authoritative world, art direction, and palette summary.',
            },
          },
        },
        sampleArgs: {
          name: 'Chronicles of Ironveil',
          tagline: 'Clockwork gothic tactical RPG',
          genre: 'Tactical RPG',
          accentHex: '#F59E0B',
          globalSummary: 'Steampunk gothic citadel lit by amber arc-lamps (#F59E0B) and oxidized brass (#2DD4BF).',
        },
      },
      {
        name: 'forge_list_vault_files',
        title: 'List or Search Project Vault Files',
        category: 'VAULT',
        modality: null,
        description:
          'Lists or searches canonical lore, style guides, JSON schemas, and reference images in a project Vault.',
        inputSchema: {
          type: 'object',
          properties: {
            projectId: { type: 'string', description: 'Optional Project ID.' },
            q: { type: 'string', description: 'Optional search query across filenames and content.' },
            scope: {
              type: 'string',
              enum: ['ALWAYS_INCLUDE', ...MODALITIES],
              description: 'Filter by ContextScope tag.',
            },
          },
        },
        sampleArgs: { q: '' },
      },
      {
        name: 'forge_read_vault_file',
        title: 'Read Vault File Content & Style Descriptor',
        category: 'VAULT',
        modality: null,
        description:
          'Reads the full text/Markdown/JSON content, Vision StyleDescriptor, and scope tags of a Project Vault file by fileId or @mention name.',
        inputSchema: {
          type: 'object',
          required: ['fileIdOrMention'],
          properties: {
            fileIdOrMention: {
              type: 'string',
              description: 'Vault File ID or @mention alias / filename.',
            },
            projectId: { type: 'string', description: 'Optional Project ID.' },
          },
        },
        sampleArgs: { fileIdOrMention: 'world-bible' },
      },
      {
        name: 'forge_write_vault_file',
        title: 'Create or Update Vault File',
        category: 'VAULT',
        modality: null,
        description:
          'Creates or updates a Markdown (.md), Text (.txt), or JSON (.json) file in the Project Vault with ContextScope tags so future AI generations automatically use it.',
        inputSchema: {
          type: 'object',
          required: ['name', 'contentText'],
          properties: {
            projectId: { type: 'string', description: 'Optional Project ID.' },
            folderId: {
              type: 'string',
              description: 'Optional folder ID (defaults to Root folder).',
            },
            name: {
              type: 'string',
              description: 'File name ending in .md, .txt, or .json.',
            },
            contentText: {
              type: 'string',
              description: 'Full Markdown, plain text, or JSON content.',
            },
            scopes: {
              type: 'array',
              items: { type: 'string', enum: ['ALWAYS_INCLUDE', ...MODALITIES] },
              description: 'ContextScopes where this file is automatically injected.',
            },
            priority: {
              type: 'integer',
              minimum: 0,
              maximum: 100,
              default: 75,
              description: 'Context assembly priority (0-100).',
            },
          },
        },
        sampleArgs: {
          name: 'Frostforged_Relics_Guide.md',
          contentText: '# Frostforged Relics\nAll frost relics use #38BDF8 rim lighting and runic silver trim.',
          scopes: ['ALWAYS_INCLUDE', 'ICONS_2D', 'LORE'],
          priority: 80,
        },
      },
      {
        name: 'forge_list_voice_profiles',
        title: 'List Character Voice Profiles',
        category: 'VAULT',
        modality: Modality.VOICES,
        description:
          'Lists all character Voice Profiles in a project for use with forge_generate_voice.',
        inputSchema: {
          type: 'object',
          properties: {
            projectId: { type: 'string', description: 'Optional Project ID.' },
          },
        },
        sampleArgs: {},
      },
      {
        name: 'forge_list_assets',
        title: 'List & Search Generated Assets',
        category: 'ASSETS_JOBS',
        modality: null,
        description:
          'Lists generated assets in a project with filtering by modality, approval status, favorite flag, or search query.',
        inputSchema: {
          type: 'object',
          properties: {
            projectId: { type: 'string', description: 'Optional Project ID.' },
            modality: {
              type: 'string',
              enum: [...MODALITIES],
              description: 'Filter by modality.',
            },
            approval: {
              type: 'string',
              enum: ['DRAFT', 'APPROVED', 'REJECTED', 'FINAL'],
              description: 'Filter by approval status.',
            },
            q: { type: 'string', description: 'Search title or prompt.' },
            limit: { type: 'integer', minimum: 1, maximum: 50, default: 20, description: 'Max items.' },
          },
        },
        sampleArgs: { limit: 10 },
      },
      {
        name: 'forge_get_asset',
        title: 'Get Asset Details, Payload & Export File',
        category: 'ASSETS_JOBS',
        modality: null,
        description:
          'Retrieves full metadata, download URLs, inline base64 image (for visual assets) or inline text (for Lore/Code assets), and optionally exports the asset file to a local path.',
        inputSchema: {
          type: 'object',
          required: ['assetId'],
          properties: {
            assetId: { type: 'string', description: 'Generated Asset ID.' },
            exportToPath: {
              type: 'string',
              description: 'Optional local filesystem path to copy the primary asset file.',
            },
          },
        },
        sampleArgs: { assetId: '' },
      },
      {
        name: 'forge_save_asset_to_vault',
        title: 'Promote Generated Asset to Project Vault',
        category: 'ASSETS_JOBS',
        modality: null,
        description:
          'Copies a generated asset (such as a 2D icon, concept art, or generated Lore backstory) into the Project Vault with ContextScope tags.',
        inputSchema: {
          type: 'object',
          required: ['assetId'],
          properties: {
            assetId: { type: 'string', description: 'Generated Asset ID to promote.' },
            scopes: {
              type: 'array',
              items: { type: 'string', enum: ['ALWAYS_INCLUDE', ...MODALITIES] },
              description: 'ContextScopes to assign.',
            },
          },
        },
        sampleArgs: { assetId: '', scopes: ['ALWAYS_INCLUDE'] },
      },
      {
        name: 'forge_get_job_status',
        title: 'Get or Await Generation Job Status',
        category: 'ASSETS_JOBS',
        modality: null,
        description:
          'Checks or awaits the status of a generation job by jobId, or cancels an active job.',
        inputSchema: {
          type: 'object',
          required: ['jobId'],
          properties: {
            jobId: { type: 'string', description: 'Generation Job ID.' },
            waitForCompletion: {
              type: 'boolean',
              default: false,
              description: 'Wait until the job finishes before returning.',
            },
            cancel: {
              type: 'boolean',
              default: false,
              description: 'Cancel the job if it is still active.',
            },
          },
        },
        sampleArgs: { jobId: '', waitForCompletion: false },
      },
    ];
  }

  async listResources(): Promise<McpResourceDefinition[]> {
    const projects = await this.projectsService.list(false);
    const resources: McpResourceDefinition[] = [
      {
        uri: 'forge://projects',
        name: 'ForgeStudio Projects Directory',
        description: 'All active projects, palettes, and canon summaries.',
        mimeType: 'application/json',
      },
    ];

    const primaryProject = projects[0];
    if (primaryProject) {
      const vaultFiles = await this.vaultFilesService.list(primaryProject.id, {});
      for (const vf of vaultFiles.slice(0, 25)) {
        resources.push({
          uri: `forge://projects/${primaryProject.id}/vault/${vf.id}`,
          name: `${primaryProject.name} / ${vf.name}`,
          description: vf.description || `Vault ${vf.kind} file (${vf.scopes.join(', ')})`,
          mimeType: vf.mimeType,
        });
      }
    }

    return resources;
  }

  async readResource(uri: string): Promise<{
    uri: string;
    mimeType: string;
    text: string;
  }> {
    if (uri === 'forge://projects') {
      const projects = await this.projectsService.list(false);
      return {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(projects, null, 2),
      };
    }

    const vaultMatch = /^forge:\/\/projects\/([^/]+)\/vault\/([^/]+)$/.exec(uri);
    if (vaultMatch) {
      const fileId = vaultMatch[2]!;
      const detail = await this.vaultFilesService.get(fileId);
      return {
        uri,
        mimeType: detail.mimeType || 'text/plain',
        text:
          detail.contentText ??
          detail.styleDescriptorText ??
          JSON.stringify(detail, null, 2),
      };
    }

    throw new DomainError(ErrorCode.NOT_FOUND, 404, `MCP Resource not found: ${uri}`);
  }

  listPrompts(): McpPromptDefinition[] {
    return [
      {
        name: 'generate-item-icon-and-lore',
        description:
          'Generates both a transparent 2D game icon and a canonical item lore description, returning both assets ready for game integration.',
        arguments: [
          {
            name: 'itemConcept',
            description: 'Name and visual/narrative concept of the item.',
            required: true,
          },
          {
            name: 'exportIconPath',
            description: 'Optional local file path to save the generated 2D icon PNG.',
            required: false,
          },
        ],
      },
      {
        name: 'author-character-backstory',
        description:
          'Generates a comprehensive Long-Form character backstory aligned with the Project Vault and promotes it into the Vault.',
        arguments: [
          {
            name: 'characterPrompt',
            description: 'Character name, role, faction, and key conflict.',
            required: true,
          },
        ],
      },
    ];
  }

  getPrompt(
    name: string,
    args: Record<string, string> = {},
  ): {
    description: string;
    messages: Array<{ role: 'user'; content: { type: 'text'; text: string } }>;
  } {
    if (name === 'generate-item-icon-and-lore') {
      const concept = args['itemConcept'] || 'Starforged Astral Relic';
      const exportHint = args['exportIconPath']
        ? ` Set exportToPath="${args['exportIconPath']}" on forge_generate_2d_icon.`
        : '';
      return {
        description: 'Generate a 2D game icon and matching short-form item lore.',
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Use the ForgeStudio MCP tools to create a complete game item for "${concept}":\n1. Call \`forge_generate_2d_icon\` with prompt="${concept}" and removeBackground=true.${exportHint}\n2. Call \`forge_generate_lore\` with prompt="${concept}", lengthForm="SHORT_FORM", loreCategory="ITEM_DESCRIPTION".\n3. Present the generated icon and item lore together.`,
            },
          },
        ],
      };
    }

    const charPrompt = args['characterPrompt'] || 'Exiled star-navigator of House Lyra';
    return {
      description: 'Author a Long-Form character backstory and save it to the Project Vault.',
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Call \`forge_generate_lore\` with prompt="${charPrompt}", lengthForm="LONG_FORM", loreCategory="CHARACTER_BACKSTORY", targetWordCount=1000, includeSections=true, and saveToVault=true.`,
          },
        },
      ],
    };
  }

  async getStatus(baseUrl = 'http://localhost:3333'): Promise<McpServerStatusModel> {
    const [tools, resources, recentLogs, dbCount] = await Promise.all([
      Promise.resolve(this.getTools()),
      this.listResources(),
      this.getLogs(),
      this.getTotalInvocations(),
    ]);
    const prompts = this.listPrompts();
    const cleanBase = baseUrl.replace(/\/$/, '');

    return {
      serverName: 'forgestudio-control-room-mcp',
      serverVersion: '1.0.0',
      protocolVersion: '2025-03-26',
      httpEndpoint: `${cleanBase}/api/v1/mcp`,
      sseEndpoint: `${cleanBase}/api/v1/mcp/sse`,
      stdioCommand: 'npm',
      stdioArgs: ['run', 'mcp:stdio', '-w', '@forge/backend'],
      toolCount: tools.length,
      resourceCount: resources.length,
      promptCount: prompts.length,
      totalInvocations: dbCount,
      hardwareProfile: {
        systemRamGb: 32,
        ramType: 'DDR5',
        vramFallbackEnabled: true,
        recommendedMemoryStrategy: 'RAM_FALLBACK_32GB',
        notes:
          '32GB DDR5 System RAM shared-memory offload active as automatic fallback when GPU VRAM reaches capacity.',
      },
      recentLogs,
    };
  }

  async getLogs(): Promise<McpInvocationLogEntry[]> {
    if (this.prisma.mcpInvocationLog?.findMany) {
      try {
        const rows = await this.prisma.mcpInvocationLog.findMany({
          orderBy: { createdAt: 'desc' },
          take: MAX_LOG_ENTRIES,
        });
        return rows.map((r) => ({
          id: r.id,
          timestamp: r.createdAt.toISOString(),
          toolName: r.toolName,
          transport: (r.transport as 'HTTP_RPC' | 'STDIO' | 'PLAYGROUND') ?? 'HTTP_RPC',
          durationMs: r.durationMs,
          isError: r.isError,
          argsSummary: r.argsSummary,
          assetIds: r.assetIds,
          primaryAssetUrl: r.primaryAssetUrl,
          primaryModality: (r.primaryModality as Modality | null) ?? null,
          errorMessage: r.errorMessage,
        }));
      } catch {
        // Fall through to in-memory cache
      }
    }
    return [...this.logs];
  }

  private async getTotalInvocations(): Promise<number> {
    if (this.prisma.mcpInvocationLog?.count) {
      try {
        const count = await this.prisma.mcpInvocationLog.count();
        return Math.max(count, this.totalInvocations);
      } catch {
        // Fall through
      }
    }
    return this.totalInvocations;
  }

  private sanitizeArgsForSummary(rawArgs: Record<string, unknown>): string {
    const cleaned: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rawArgs)) {
      if (typeof v === 'string' && v.length > 200) {
        cleaned[k] = `${v.slice(0, 80)}…[${v.length} chars]`;
      } else {
        cleaned[k] = v;
      }
    }
    return JSON.stringify(cleaned).slice(0, 180);
  }

  async callTool(
    toolName: string,
    rawArgs: Record<string, unknown> = {},
    transport: 'HTTP_RPC' | 'STDIO' | 'PLAYGROUND' = 'HTTP_RPC',
  ): Promise<McpToolCallResult> {
    const startedMs = Date.now();
    this.totalInvocations += 1;
    const logId = `mcp_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const argsSummary = this.sanitizeArgsForSummary(rawArgs);

    try {
      const result = await this.dispatchTool(toolName, rawArgs);
      const durationMs = Math.max(1, Date.now() - startedMs);

      const structured = result.structuredContent ?? {};
      const assetIds = Array.isArray(structured['assetIds'])
        ? (structured['assetIds'] as string[])
        : [];
      const primaryAssetUrl =
        typeof structured['primaryUrl'] === 'string' ? structured['primaryUrl'] : null;
      const primaryModality =
        typeof structured['modality'] === 'string'
          ? (structured['modality'] as Modality)
          : null;

      await this.recordLog({
        id: logId,
        timestamp: new Date().toISOString(),
        toolName,
        transport,
        durationMs,
        isError: Boolean(result.isError),
        argsSummary,
        assetIds,
        primaryAssetUrl,
        primaryModality,
        errorMessage: null,
      });

      return result;
    } catch (err) {
      const durationMs = Math.max(1, Date.now() - startedMs);
      const message = err instanceof Error ? err.message : String(err);

      await this.recordLog({
        id: logId,
        timestamp: new Date().toISOString(),
        toolName,
        transport,
        durationMs,
        isError: true,
        argsSummary,
        assetIds: [],
        primaryAssetUrl: null,
        primaryModality: null,
        errorMessage: message,
      });

      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: JSON.stringify({ error: message, toolName }, null, 2),
          },
        ],
      };
    }
  }

  private async recordLog(entry: McpInvocationLogEntry): Promise<void> {
    this.logs.unshift(entry);
    if (this.logs.length > MAX_LOG_ENTRIES) {
      this.logs.length = MAX_LOG_ENTRIES;
    }

    if (this.prisma.mcpInvocationLog?.create) {
      try {
        await this.prisma.mcpInvocationLog.create({
          data: {
            id: entry.id,
            toolName: entry.toolName,
            transport: entry.transport,
            durationMs: entry.durationMs,
            isError: entry.isError,
            argsSummary: entry.argsSummary,
            assetIds: entry.assetIds,
            primaryAssetUrl: entry.primaryAssetUrl,
            primaryModality: entry.primaryModality,
            errorMessage: entry.errorMessage,
            createdAt: new Date(entry.timestamp),
          },
        });

        // Prune older entries beyond MAX_DB_LOG_ROWS asynchronously
        void this.pruneOldDbLogs();
      } catch {
        // Keep in-memory entry on DB error
      }
    }

    const total = await this.getTotalInvocations();
    this.events?.mcpInvocation?.({
      entry,
      totalInvocations: total,
    });
  }

  private async pruneOldDbLogs(): Promise<void> {
    if (!this.prisma.mcpInvocationLog?.findMany || !this.prisma.mcpInvocationLog?.deleteMany) {
      return;
    }
    try {
      const boundary = await this.prisma.mcpInvocationLog.findMany({
        orderBy: { createdAt: 'desc' },
        skip: MAX_DB_LOG_ROWS,
        take: 1,
        select: { createdAt: true },
      });
      const cutoff = boundary[0]?.createdAt;
      if (cutoff) {
        await this.prisma.mcpInvocationLog.deleteMany({
          where: { createdAt: { lte: cutoff } },
        });
      }
    } catch {
      // Ignore pruning errors
    }
  }

  private async dispatchTool(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<McpToolCallResult> {
    switch (toolName) {
      case 'forge_generate_2d_icon':
        return this.executeGenerationTool(Modality.ICONS_2D, args, {
          iconCategory: this.str(args['iconCategory'], 'ITEM'),
          frameShape: this.str(args['frameShape'], 'NONE'),
          removeBackground: this.bool(args['removeBackground'], true),
          outputSize: args['outputSize'] === 512 ? 512 : 1024,
          batchCount: this.int(args['batchCount'], 1, 1, 4),
        });

      case 'forge_generate_3d_asset':
        return this.executeGenerationTool(Modality.ASSETS_3D, args, {
          subMode: this.str(args['subMode'], 'TEXT_TO_3D'),
          assetCategory: this.str(args['assetCategory'], 'WEAPON'),
          polycountTier: this.str(args['polycountTier'], 'LOW_POLY'),
          pose: this.str(args['pose'], 'NONE'),
          enablePbr: this.bool(args['enablePbr'], true),
          referenceStorageKey:
            typeof args['referenceStorageKey'] === 'string'
              ? args['referenceStorageKey']
              : null,
        });

      case 'forge_generate_image':
        return this.executeGenerationTool(Modality.IMAGES, args, {
          imageCategory: this.str(args['imageCategory'], 'CONCEPT_ART'),
          aspectPreset: this.str(args['aspectPreset'], 'THUMB_16_9'),
          batchCount: this.int(args['batchCount'], 1, 1, 4),
        });

      case 'forge_generate_video':
        return this.executeGenerationTool(Modality.VIDEO, args, {
          subMode: this.str(args['subMode'], 'TEXT_TO_VIDEO'),
          videoCategory: this.str(args['videoCategory'], 'CUTSCENE'),
          durationSec: this.num(args['durationSec'], 5, 2, 16),
          fps: args['fps'] === 30 ? 30 : args['fps'] === 60 ? 60 : 24,
          aspectRatio: this.str(args['aspectRatio'], '16:9'),
          resolution: this.str(args['resolution'], '1080p'),
          cameraMotion: this.str(args['cameraMotion'], 'ORBIT'),
          motionIntensity: this.num(args['motionIntensity'], 0.5, 0, 1),
          loopable: this.bool(args['loopable'], true),
          includeAudio: this.bool(args['includeAudio'], false),
          memoryStrategy: this.str(args['memoryStrategy'], 'RAM_FALLBACK_32GB'),
          referenceStorageKey:
            typeof args['referenceStorageKey'] === 'string'
              ? args['referenceStorageKey']
              : null,
        });

      case 'forge_generate_lore': {
        const lengthForm = this.str(args['lengthForm'], 'SHORT_FORM');
        const defaultWords =
          lengthForm === 'LONG_FORM' ? 900 : lengthForm === 'MEDIUM_FORM' ? 350 : 100;
        return this.executeGenerationTool(Modality.LORE, args, {
          lengthForm,
          loreCategory: this.str(args['loreCategory'], 'ITEM_DESCRIPTION'),
          tone: this.str(args['tone'], 'IN_WORLD_DIEGETIC'),
          perspective: this.str(args['perspective'], 'THIRD_PERSON_OMNISCIENT'),
          targetWordCount: this.int(args['targetWordCount'], defaultWords, 20, 3000),
          includeSections: this.bool(
            args['includeSections'],
            lengthForm !== 'SHORT_FORM',
          ),
          outputFormat: this.str(args['outputFormat'], 'MARKDOWN'),
          batchCount: this.int(args['batchCount'], 1, 1, 3),
        });
      }

      case 'forge_generate_music':
        return this.executeGenerationTool(Modality.MUSIC, args, {
          trackType: this.str(args['trackType'], 'BGM_LOOP'),
          durationSec: this.num(args['durationSec'], 15, 5, 300),
          bpm: this.int(args['bpm'], 110, 40, 220),
          keySignature: this.str(args['keySignature'], 'D Dorian'),
          seamlessLoop: this.bool(args['seamlessLoop'], true),
          generateStems: this.bool(args['generateStems'], false),
        });

      case 'forge_generate_voice': {
        const transcript = this.str(
          args['transcript'],
          this.str(args['prompt'], 'Every star remembers.'),
        );
        return this.executeGenerationTool(
          Modality.VOICES,
          { ...args, prompt: this.str(args['prompt'], transcript) },
          {
            transcript,
            voiceProfileId:
              typeof args['voiceProfileId'] === 'string' && args['voiceProfileId']
                ? args['voiceProfileId']
                : null,
            lineType: this.str(args['lineType'], 'DIALOGUE'),
            speed: this.num(args['speed'], 1.0, 0.7, 1.3),
          },
        );
      }

      case 'forge_generate_sfx':
        return this.executeGenerationTool(Modality.SFX, args, {
          sfxCategory: this.str(args['sfxCategory'], 'MAGIC'),
          durationSec: this.num(args['durationSec'], 1.8, 0.5, 22),
          variationCount: this.int(args['variationCount'], 2, 1, 8),
          loopable: this.bool(args['loopable'], false),
        });

      case 'forge_generate_code_or_sprite': {
        const subMode = this.str(args['subMode'], 'SHADER_CODE');
        return this.executeGenerationTool(Modality.OTHER, args, {
          subMode,
          shader: {
            language: this.str(args['shaderLanguage'], 'GLSL'),
            targetEngine: this.str(args['targetEngine'], 'GODOT'),
          },
          loreJson: {
            schemaKind: this.str(args['schemaKind'], 'ITEM_TABLE'),
            entryCount: this.int(args['entryCount'], 6, 1, 50),
            customSchema: null,
          },
        });
      }

      case 'forge_generate_asset': {
        const modalityRaw = this.str(args['modality'], 'ICONS_2D') as Modality;
        const modality = MODALITIES.includes(modalityRaw)
          ? modalityRaw
          : Modality.ICONS_2D;
        const extraParams =
          typeof args['params'] === 'object' && args['params'] !== null
            ? (args['params'] as Record<string, unknown>)
            : {};
        return this.executeGenerationTool(modality, args, extraParams);
      }

      case 'forge_compile_prompt': {
        const projectId = await this.resolveProjectId(args['projectId']);
        const modalityRaw = this.str(args['modality'], 'ICONS_2D') as Modality;
        const modality = MODALITIES.includes(modalityRaw)
          ? modalityRaw
          : Modality.ICONS_2D;
        const providerConfigId = await this.resolveProviderId(
          modality,
          args['providerConfigId'],
        );
        const rawPrompt = this.str(args['prompt'], 'Starforged relic');
        const params = defaultParamsFor(modality);

        const res = await this.middlemanCompiler.preview({
          projectId,
          modality,
          rawPrompt,
          pinnedFileIds: [],
          params,
          providerConfigId,
        });

        const payload = {
          projectId,
          modality,
          compiled: res.compiled,
          contextFiles: res.contextFiles,
          usage: res.usage,
        };
        return {
          structuredContent: payload,
          content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
        };
      }

      case 'forge_preview_vault_context': {
        const projectId = await this.resolveProjectId(args['projectId']);
        const modalityRaw = this.str(args['modality'], 'ICONS_2D') as Modality;
        const modality = MODALITIES.includes(modalityRaw)
          ? modalityRaw
          : Modality.ICONS_2D;
        const rawPrompt = this.str(args['prompt'], '');
        const preview = await this.vaultFilesService.contextPreview(projectId, {
          modality,
          rawPrompt,
        });
        return {
          structuredContent: { projectId, modality, ...preview },
          content: [{ type: 'text', text: JSON.stringify(preview, null, 2) }],
        };
      }

      case 'forge_list_projects': {
        const includeArchived = this.bool(args['includeArchived'], false);
        const projects = await this.projectsService.list(includeArchived);
        return {
          structuredContent: { projects },
          content: [{ type: 'text', text: JSON.stringify(projects, null, 2) }],
        };
      }

      case 'forge_create_project': {
        const created = await this.projectsService.create({
          name: this.str(args['name'], 'New ForgeStudio Project'),
          tagline: this.str(args['tagline'], ''),
          description: this.str(args['description'], ''),
          genre: this.str(args['genre'], 'RPG'),
          accentHex: this.str(args['accentHex'], '#7C3AED'),
          globalSummary: this.str(args['globalSummary'], ''),
        });
        return {
          structuredContent: { project: created },
          content: [{ type: 'text', text: JSON.stringify(created, null, 2) }],
        };
      }

      case 'forge_list_vault_files': {
        const projectId = await this.resolveProjectId(args['projectId']);
        const q = this.str(args['q'], '').trim();
        const scope =
          typeof args['scope'] === 'string' && args['scope'].length > 0
            ? (args['scope'] as ContextScope)
            : undefined;
        const files = q
          ? await this.vaultFilesService.search(projectId, {
              q,
              scope,
              limit: 30,
            })
          : await this.vaultFilesService.list(projectId, { scope });
        return {
          structuredContent: { projectId, files },
          content: [{ type: 'text', text: JSON.stringify(files, null, 2) }],
        };
      }

      case 'forge_read_vault_file': {
        const projectId = await this.resolveProjectId(args['projectId']);
        const key = this.str(args['fileIdOrMention'], '').replace(/^@/, '');
        const allFiles = await this.vaultFilesService.list(projectId, {});
        const matched =
          allFiles.find((f) => f.id === key) ??
          allFiles.find(
            (f) =>
              normalizeForMention(f.name) === normalizeForMention(key) ||
              normalizeForMention(f.name.replace(/\.[^.]+$/, '')) ===
                normalizeForMention(key),
          ) ??
          allFiles[0];

        if (!matched) {
          throw new DomainError(
            ErrorCode.NOT_FOUND,
            404,
            `Vault file "${key}" not found in project ${projectId}`,
          );
        }
        const detail = await this.vaultFilesService.get(matched.id);
        return {
          structuredContent: { file: detail },
          content: [{ type: 'text', text: JSON.stringify(detail, null, 2) }],
        };
      }

      case 'forge_write_vault_file': {
        const projectId = await this.resolveProjectId(args['projectId']);
        let folderId =
          typeof args['folderId'] === 'string' && args['folderId']
            ? args['folderId']
            : '';
        if (!folderId) {
          const rootFolder = await this.prisma.vaultFolder.findFirst({
            where: { projectId, path: '/' },
          });
          if (!rootFolder) {
            throw new DomainError(
              ErrorCode.NOT_FOUND,
              404,
              `Root vault folder not found for project ${projectId}`,
            );
          }
          folderId = rootFolder.id;
        }
        const rawName = this.str(args['name'], 'Note.md');
        const validName = /\.(md|txt|json)$/i.test(rawName)
          ? rawName
          : `${rawName}.md`;
        const scopesRaw = Array.isArray(args['scopes'])
          ? (args['scopes'] as ContextScope[])
          : [ContextScope.ALWAYS_INCLUDE];

        const created = await this.vaultFilesService.createText(projectId, {
          folderId,
          name: validName,
          contentText: this.str(args['contentText'], ''),
          scopes: scopesRaw,
          priority: this.int(args['priority'], 75, 0, 100),
          description: this.str(args['description'], 'Created via MCP Server'),
        });
        return {
          structuredContent: { file: created },
          content: [{ type: 'text', text: JSON.stringify(created, null, 2) }],
        };
      }

      case 'forge_list_voice_profiles': {
        const projectId = await this.resolveProjectId(args['projectId']);
        const profiles = await this.voiceProfilesService.list(projectId);
        return {
          structuredContent: { projectId, profiles },
          content: [{ type: 'text', text: JSON.stringify(profiles, null, 2) }],
        };
      }

      case 'forge_list_assets': {
        const projectId = await this.resolveProjectId(args['projectId']);
        const modality =
          typeof args['modality'] === 'string' &&
          MODALITIES.includes(args['modality'] as Modality)
            ? (args['modality'] as Modality)
            : undefined;
        const approval =
          typeof args['approval'] === 'string'
            ? (args['approval'] as ApprovalStatus)
            : undefined;
        const list = await this.assetsService.list({
          projectId,
          modality,
          approval,
          q: typeof args['q'] === 'string' ? args['q'] : undefined,
          sort: 'newest',
          limit: this.int(args['limit'], 20, 1, 50),
        });
        return {
          structuredContent: { projectId, ...list },
          content: [{ type: 'text', text: JSON.stringify(list, null, 2) }],
        };
      }

      case 'forge_get_asset': {
        const assetId = await this.resolveAssetId(args['assetId']);
        const asset = await this.assetsService.get(assetId);
        const exportToPath =
          typeof args['exportToPath'] === 'string' && args['exportToPath'].trim()
            ? args['exportToPath'].trim()
            : undefined;
        return this.buildAssetResult([asset], asset.jobId ?? '', exportToPath);
      }

      case 'forge_save_asset_to_vault': {
        const assetId = await this.resolveAssetId(args['assetId']);
        const asset = await this.assetsService.get(assetId);
        const rootFolder = await this.prisma.vaultFolder.findFirst({
          where: { projectId: asset.projectId, path: '/' },
        });
        if (!rootFolder) {
          throw new DomainError(
            ErrorCode.NOT_FOUND,
            404,
            `Root folder not found for project ${asset.projectId}`,
          );
        }
        const scopes =
          Array.isArray(args['scopes']) && args['scopes'].length > 0
            ? (args['scopes'] as ContextScope[])
            : [ContextScope.ALWAYS_INCLUDE];
        const saved = await this.assetsService.saveToVault(asset.id, {
          folderId: rootFolder.id,
          scopes,
          runVision: true,
          fileRole: AssetFileRole.PRIMARY,
        });
        return {
          structuredContent: { vaultFile: saved },
          content: [{ type: 'text', text: JSON.stringify(saved, null, 2) }],
        };
      }

      case 'forge_get_job_status': {
        let jobId = this.str(args['jobId'], '');
        if (!jobId) {
          const latestJob = await this.prisma.generationJob.findFirst({
            orderBy: { createdAt: 'desc' },
          });
          if (!latestJob) {
            throw new DomainError(ErrorCode.NOT_FOUND, 404, 'No jobs found');
          }
          jobId = latestJob.id;
        }
        if (this.bool(args['cancel'], false)) {
          const cancelled = await this.jobsService.cancel(jobId);
          return {
            structuredContent: { job: cancelled },
            content: [{ type: 'text', text: JSON.stringify(cancelled, null, 2) }],
          };
        }
        const job = this.bool(args['waitForCompletion'], false)
          ? await this.waitForJobCompletion(jobId, 120_000)
          : await this.jobsService.get(jobId);
        return {
          structuredContent: { job },
          content: [{ type: 'text', text: JSON.stringify(job, null, 2) }],
        };
      }

      default:
        throw new DomainError(
          ErrorCode.NOT_FOUND,
          404,
          `Unknown MCP tool: "${toolName}"`,
        );
    }
  }

  private async executeGenerationTool(
    modality: Modality,
    args: Record<string, unknown>,
    modalityParamOverrides: Record<string, unknown>,
  ): Promise<McpToolCallResult> {
    const projectId = await this.resolveProjectId(args['projectId']);
    const providerConfigId = await this.resolveProviderId(
      modality,
      args['providerConfigId'],
    );
    const rawPrompt = this.str(
      args['prompt'],
      `Canonical ${modality} asset for project`,
    );
    const skipMiddleman = this.bool(args['skipMiddleman'], false);
    const waitForCompletion = this.bool(args['waitForCompletion'], true);
    const exportToPath =
      typeof args['exportToPath'] === 'string' && args['exportToPath'].trim()
        ? args['exportToPath'].trim()
        : undefined;

    const baseParams = defaultParamsFor(modality);
    const mergedModalityParams = ModalityParamsSchema.parse({
      ...baseParams,
      ...modalityParamOverrides,
      modality,
    }) as ModalityParams;

    const advanced =
      typeof args['advanced'] === 'object' && args['advanced'] !== null
        ? (args['advanced'] as Record<string, string | number | boolean>)
        : {};

    const createDto: CreateJobDto = {
      projectId,
      executionMode: ExecutionMode.AUTO_FIRE,
      rawPrompt,
      pinnedFileIds: Array.isArray(args['pinnedFileIds'])
        ? (args['pinnedFileIds'] as string[])
        : [],
      params: mergedModalityParams,
      advanced,
      providerConfigId,
      providerModel:
        typeof args['providerModel'] === 'string' ? args['providerModel'] : null,
      middlemanProfileId: null,
      skipMiddleman,
      parentAssetId: null,
    };

    const job = await this.jobsService.create(createDto);

    if (!waitForCompletion) {
      const asyncPayload = {
        status: job.status,
        jobId: job.id,
        projectId,
        modality,
        message:
          'Job dispatched asynchronously. Call forge_get_job_status with waitForCompletion=true to retrieve the generated asset.',
      };
      return {
        structuredContent: asyncPayload,
        content: [{ type: 'text', text: JSON.stringify(asyncPayload, null, 2) }],
      };
    }

    const finishedJob = await this.waitForJobCompletion(job.id, 120_000);
    if (finishedJob.status !== JobStatus.COMPLETED) {
      throw new DomainError(
        ErrorCode.PROVIDER_ERROR,
        502,
        `Generation job ${job.id} ended in status ${finishedJob.status}: ${finishedJob.errorMessage ?? 'Unknown error'}`,
      );
    }

    const assets: AssetModel[] = [];
    for (const assetId of finishedJob.assetIds) {
      const asset = await this.assetsService.get(assetId);
      assets.push(asset);
    }

    // Optional auto-promotion to Project Vault (e.g. for forge_generate_lore saveToVault=true)
    let savedVaultFileId: string | null = null;
    if (this.bool(args['saveToVault'], false) && assets[0]) {
      const rootFolder = await this.prisma.vaultFolder.findFirst({
        where: { projectId, path: '/' },
      });
      if (rootFolder) {
        const vf = await this.assetsService.saveToVault(assets[0].id, {
          folderId: rootFolder.id,
          scopes: [ContextScope.ALWAYS_INCLUDE, modality as unknown as ContextScope],
          runVision: false,
          fileRole: AssetFileRole.PRIMARY,
        });
        savedVaultFileId = vf.id;
      }
    }

    return this.buildAssetResult(
      assets,
      finishedJob.id,
      exportToPath,
      savedVaultFileId,
    );
  }

  private async buildAssetResult(
    assets: AssetModel[],
    jobId: string,
    exportToPath?: string,
    savedVaultFileId: string | null = null,
  ): Promise<McpToolCallResult> {
    const primaryAsset = assets[0];
    if (!primaryAsset) {
      throw new DomainError(
        ErrorCode.NOT_FOUND,
        404,
        'No generated assets found for completed job',
      );
    }

    const dbAssetFiles = await this.prisma.generatedAssetFile.findMany({
      where: { assetId: primaryAsset.id },
      orderBy: { sortIndex: 'asc' },
    });
    const primaryDbFile =
      dbAssetFiles.find((f) => f.role === AssetFileRole.PRIMARY) ??
      dbAssetFiles[0];

    let primaryBuf: Buffer | null = null;
    if (primaryDbFile) {
      try {
        primaryBuf = await this.storage.getBuffer(primaryDbFile.storageKey);
      } catch {
        primaryBuf = null;
      }
    }

    let exportedPath: string | null = null;
    if (exportToPath && primaryBuf) {
      const resolvedOut = path.resolve(exportToPath);
      await fs.mkdir(path.dirname(resolvedOut), { recursive: true });
      await fs.writeFile(resolvedOut, primaryBuf);
      exportedPath = resolvedOut;
    }

    let inlineTextContent: string | null = null;
    if (
      primaryBuf &&
      (primaryAsset.modality === Modality.LORE ||
        (primaryAsset.modality === Modality.OTHER &&
          (primaryAsset.subMode === 'SHADER_CODE' ||
            primaryAsset.subMode === 'LORE_JSON')))
    ) {
      inlineTextContent = primaryBuf.toString('utf8');
    }

    const summaryPayload: Record<string, unknown> = {
      status: 'COMPLETED',
      jobId,
      projectId: primaryAsset.projectId,
      modality: primaryAsset.modality,
      assetIds: assets.map((a) => a.id),
      primaryAssetId: primaryAsset.id,
      title: primaryAsset.title,
      primaryUrl: primaryAsset.primaryUrl,
      thumbnailUrl: primaryAsset.thumbnailUrl,
      exportedToPath: exportedPath,
      savedToVaultFileId: savedVaultFileId ?? primaryAsset.savedToVaultFileId,
      enhancedPrompt: primaryAsset.enhancedPrompt,
      metadata: primaryAsset.metadata,
      files: primaryAsset.files,
      ...(inlineTextContent !== null ? { textContent: inlineTextContent } : {}),
    };

    const contentBlocks: McpContentBlock[] = [
      {
        type: 'text',
        text: JSON.stringify(summaryPayload, null, 2),
      },
    ];

    if (inlineTextContent !== null) {
      contentBlocks.push({
        type: 'text',
        text: inlineTextContent,
      });
    } else if (primaryBuf && primaryDbFile) {
      if (primaryDbFile.mimeType.startsWith('image/')) {
        contentBlocks.push({
          type: 'image',
          data: primaryBuf.toString('base64'),
          mimeType: primaryDbFile.mimeType,
        });
      } else {
        // Check if there is a thumbnail image we can attach as visual preview (e.g. for 3D or Video)
        const thumbDbFile = dbAssetFiles.find(
          (f) => f.role === AssetFileRole.THUMBNAIL,
        );
        if (thumbDbFile) {
          try {
            const thumbBuf = await this.storage.getBuffer(thumbDbFile.storageKey);
            contentBlocks.push({
              type: 'image',
              data: thumbBuf.toString('base64'),
              mimeType: thumbDbFile.mimeType,
            });
          } catch {
            // Ignore thumbnail read error
          }
        }
      }
    }

    return {
      structuredContent: summaryPayload,
      content: contentBlocks,
    };
  }

  private async waitForJobCompletion(jobId: string, timeoutMs: number) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const job = await this.jobsService.get(jobId);
      if (TERMINAL_JOB_STATUSES.includes(job.status)) {
        return job;
      }
      await sleep(140);
    }
    throw new DomainError(
      ErrorCode.PROVIDER_TIMEOUT,
      504,
      `Timed out waiting for generation job ${jobId} after ${Math.round(timeoutMs / 1000)}s`,
    );
  }

  private async resolveProjectId(rawProjectId: unknown): Promise<string> {
    if (typeof rawProjectId === 'string' && rawProjectId.trim().length > 0) {
      const found = await this.prisma.project.findFirst({
        where: {
          OR: [{ id: rawProjectId.trim() }, { slug: rawProjectId.trim() }],
        },
      });
      if (found) return found.id;
    }

    const firstProject = await this.prisma.project.findFirst({
      where: { archivedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    if (firstProject) {
      return firstProject.id;
    }

    const created = await this.projectsService.create({
      name: 'Project Starfall: Echoes of Aethelgard',
      tagline: 'Astral fantasy action RPG',
      description: 'Auto-created default project for MCP Server.',
      genre: 'Action RPG',
      accentHex: '#7C3AED',
      globalSummary:
        'Stylized astral fantasy world with obsidian stone (#140E36), nebula violet (#7C3AED), starlight gold (#F5C451), and cyan aether (#38BDF8).',
    });
    return created.id;
  }

  private async resolveProviderId(
    modality: Modality,
    rawProviderId: unknown,
  ): Promise<string> {
    if (typeof rawProviderId === 'string' && rawProviderId.trim().length > 0) {
      return rawProviderId.trim();
    }

    const allProviders = await this.providersService.list();
    const enabled = allProviders.filter(
      (p) => p.isEnabled && p.modalities.includes(modality),
    );
    const defaultForMod = enabled.find((p) =>
      p.defaultForModalities.includes(modality),
    );
    if (defaultForMod) return defaultForMod.id;

    const demoProvider = enabled.find((p) => p.kind === ProviderKind.DEMO);
    if (demoProvider) return demoProvider.id;

    if (enabled[0]) return enabled[0].id;

    throw new DomainError(
      ErrorCode.PROVIDER_NOT_CONFIGURED,
      400,
      `No enabled provider found supporting modality ${modality}`,
    );
  }

  private async resolveAssetId(rawAssetId: unknown): Promise<string> {
    if (typeof rawAssetId === 'string' && rawAssetId.trim().length > 0) {
      return rawAssetId.trim();
    }
    const latest = await this.prisma.generatedAsset.findFirst({
      orderBy: { createdAt: 'desc' },
    });
    if (!latest) {
      throw new DomainError(ErrorCode.NOT_FOUND, 404, 'No generated assets found');
    }
    return latest.id;
  }

  private str(val: unknown, fallback: string): string {
    return typeof val === 'string' && val.trim().length > 0 ? val.trim() : fallback;
  }

  private bool(val: unknown, fallback: boolean): boolean {
    if (typeof val === 'boolean') return val;
    if (val === 'true') return true;
    if (val === 'false') return false;
    return fallback;
  }

  private num(val: unknown, fallback: number, min: number, max: number): number {
    const n = typeof val === 'number' ? val : Number(val);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  }

  private int(val: unknown, fallback: number, min: number, max: number): number {
    return Math.round(this.num(val, fallback, min, max));
  }
}
