import {
  ExecutionTier,
  Modality,
  ProviderKind,
} from '@forge/shared';
import { JobsService } from '../src/generators/jobs.service';
import {
  parseDialogueScript,
  parseWavHeader,
  synthesizeDialogueScene,
} from '../src/synth/wav-audio.synth';

describe('Phase 6 — Multi-Step Workflows, Batch Matrix & Dialogue Sequencer', () => {
  function createMockJobsService(): {
    service: JobsService;
    createdJobs: Array<Record<string, unknown>>;
  } {
    const createdJobs: Array<Record<string, unknown>> = [];

    const prismaMock = {
      project: {
        findUnique: jest.fn(async () => ({ id: 'proj_1', slug: 'astra' })),
      },
      generationJob: {
        aggregate: jest.fn(async () => ({ _sum: { costUsd: 0 } })),
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          const row = {
            id: `job_${createdJobs.length + 1}`,
            ...data,
            attempt: 1,
            progressPercent: 0,
            progressStage: null,
            workerId: null,
            remoteJobId: null,
            errorCode: null,
            errorMessage: null,
            costUsd: null,
            executionMs: null,
            queueDelayMs: null,
            coldStartMs: null,
            createdAt: new Date('2026-10-31T02:00:00.000Z'),
            startedAt: null,
            completedAt: null,
            notBefore: null,
            compiledPayload: null,
            editedPayload: null,
            contextFileIds: [],
            middlemanUsage: null,
            providerConfig: {
              id: data['providerConfigId'],
              name: 'Demo Studio',
              kind: ProviderKind.DEMO,
            },
            middlemanProfile: null,
            assets: [],
          };
          createdJobs.push(row);
          return row;
        }),
      },
      generationJobEvent: {
        create: jest.fn(async () => ({})),
      },
      $transaction: jest.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
        cb(prismaMock),
      ),
    };

    const providersServiceMock = {
      getRuntimeConfig: jest.fn(async (id: string) => ({
        id,
        name: 'Demo Studio',
        kind: ProviderKind.DEMO,
        tier: ExecutionTier.FREE,
        isEnabled: true,
        modalities: [
          Modality.ICONS_2D,
          Modality.IMAGES,
          Modality.ASSETS_3D,
          Modality.LORE,
          Modality.VOICES,
        ],
        defaultModel: 'demo-v1',
        settings: { autoRetry: true, maxAttempts: 3 },
      })),
    };

    const storageMock = {
      stat: jest.fn(async () => ({ sizeBytes: 1024 })),
    };

    const service = new JobsService(
      prismaMock as never,
      providersServiceMock as never,
      { resolve: jest.fn(() => ({})) } as never,
      {} as never,
      { tick: jest.fn(async () => undefined) } as never,
      storageMock as never,
      { jobCreated: jest.fn() } as never,
    );

    return { service, createdJobs };
  }

  describe('6.1 Cross-Modality Pipeline Recipe Engine', () => {
    it('topologically sorts steps, interpolates upstream step outputs into downstream prompts/params, and detects cycles', async () => {
      const { service } = createMockJobsService();

      const res = await service.runPipeline({
        projectId: 'proj_1',
        name: 'Concept -> 3D -> Lore Pipeline',
        skipMiddleman: false,
        steps: [
          {
            stepId: 'lore',
            dependsOn: ['mesh'],
            rawPrompt:
              'Write item codex lore for {{steps.concept.rawPrompt}} (3D job {{steps.mesh.jobId}})',
            providerConfigId: 'prov_demo',
            providerModel: null,
            params: {
              modality: 'LORE',
              lengthForm: 'SHORT_FORM',
              loreCategory: 'ITEM_DESCRIPTION',
              tone: 'IN_WORLD_DIEGETIC',
              perspective: 'THIRD_PERSON_OMNISCIENT',
              targetWordCount: 100,
              includeSections: false,
              outputFormat: 'MARKDOWN',
              batchCount: 1,
              seed: null,
            },
          },
          {
            stepId: 'concept',
            dependsOn: [],
            rawPrompt: 'Obsidian Sunblade greatsword',
            providerConfigId: 'prov_demo',
            providerModel: null,
            outputs: {
              primaryStorageKey: 'projects/astra/assets/IMAGES/ast_1/v1/concept.png',
            },
            params: {
              modality: 'IMAGES',
              imageCategory: 'CONCEPT_ART',
              aspectPreset: 'SQUARE_1_1',
              styleWeight: 0.7,
              referenceStorageKey: null,
              maskStorageKey: null,
              referenceMode: 'NONE',
              referenceStrength: 0.55,
              batchCount: 1,
              seed: null,
            },
          },
          {
            stepId: 'mesh',
            dependsOn: ['concept'],
            rawPrompt: '3D model of {{steps.concept.rawPrompt}}',
            providerConfigId: 'prov_demo',
            providerModel: null,
            params: {
              modality: 'ASSETS_3D',
              subMode: 'IMAGE_TO_3D',
              referenceStorageKey: '{{steps.concept.primaryStorageKey}}',
              assetCategory: 'WEAPON',
              polycountTier: 'LOW_POLY',
              textureResolution: 2048,
              outputFormat: 'glb',
              pose: 'NONE',
              enablePbr: true,
              generateLods: true,
              topology: 'TRIANGLE',
              seed: null,
            },
          },
        ],
      });

      expect(res.stepResults.map((s) => s.stepId)).toEqual([
        'concept',
        'mesh',
        'lore',
      ]);
      expect(res.stepResults[1]?.resolvedPrompt).toBe(
        '3D model of Obsidian Sunblade greatsword',
      );
      expect(res.stepResults[2]?.resolvedPrompt).toBe(
        'Write item codex lore for Obsidian Sunblade greatsword (3D job job_2)',
      );

      // Cycle detection must throw VALIDATION_FAILED
      await expect(
        service.runPipeline({
          projectId: 'proj_1',
          name: 'Cyclic Pipeline',
          skipMiddleman: false,
          steps: [
            {
              stepId: 'a',
              dependsOn: ['b'],
              rawPrompt: 'Step A',
              providerConfigId: 'prov_demo',
              providerModel: null,
              params: {
                modality: 'ICONS_2D',
                iconCategory: 'ITEM',
                frameShape: 'NONE',
                frameStrokeHex: null,
                removeBackground: true,
                bgRemovalTolerance: 38,
                solidBackgroundHex: null,
                outputSize: 512,
                batchCount: 1,
                seed: null,
              },
            },
            {
              stepId: 'b',
              dependsOn: ['a'],
              rawPrompt: 'Step B',
              providerConfigId: 'prov_demo',
              providerModel: null,
              params: {
                modality: 'ICONS_2D',
                iconCategory: 'ITEM',
                frameShape: 'NONE',
                frameStrokeHex: null,
                removeBackground: true,
                bgRemovalTolerance: 38,
                solidBackgroundHex: null,
                outputSize: 512,
                batchCount: 1,
                seed: null,
              },
            },
          ],
        }),
      ).rejects.toThrow(/dependency cycle/);
    });
  });

  describe('6.2 Data-Driven Batch Matrix Runner', () => {
    it('expands cartesian variable combinations and interpolates {{column}} placeholders', async () => {
      const { service } = createMockJobsService();

      const res = await service.createBatchMatrix({
        projectId: 'proj_1',
        promptTemplate: '{{rarity}} {{element}} {{weapon}} RPG icon',
        variables: {
          rarity: ['Common', 'Legendary'],
          element: ['Fire', 'Frost'],
          weapon: ['Dagger', 'Bow'],
        },
        params: {
          modality: 'ICONS_2D',
          iconCategory: 'ITEM',
          frameShape: 'HEXAGON',
          frameStrokeHex: null,
          removeBackground: true,
          bgRemovalTolerance: 38,
          solidBackgroundHex: null,
          outputSize: 512,
          batchCount: 1,
          seed: null,
        },
        providerConfigId: 'prov_demo',
        providerModel: null,
        executionMode: 'AUTO_FIRE',
        skipMiddleman: false,
      });

      expect(res.count).toBe(8);
      expect(res.jobs[0]?.rawPrompt).toBe('Common Fire Dagger RPG icon');
      expect(res.jobs[7]?.rawPrompt).toBe('Legendary Frost Bow RPG icon');
    });
  });

  describe('6.3 Multi-Speaker Dialogue Scene Sequencer', () => {
    it('parses multi-character dialogue scripts and stitches turns with synchronized word alignment', () => {
      const script = [
        'Valkyrie Lyra: [HEROIC] Hold the northern gate against the void!',
        'Warden Thorne: [GRIM] The shields are holding, Commander.',
        'Oracle Seraphina: [WHISPER] Dawn approaches from the eastern spire.',
      ].join('\n');

      const turns = parseDialogueScript(script, 300);
      expect(turns).toHaveLength(3);
      expect(turns[0]?.speaker).toBe('Valkyrie Lyra');
      expect(turns[0]?.emotion).toBe('HEROIC');
      expect(turns[0]?.voiceId).toBe('soprano');
      expect(turns[1]?.voiceId).toBe('bass');

      const scene = synthesizeDialogueScene({
        turns,
        seed: 777,
        defaultPauseMs: 300,
      });

      expect(scene.turnStems).toHaveLength(3);
      expect(scene.turnStems[1]!.startMs).toBeGreaterThanOrEqual(
        scene.turnStems[0]!.endMs + 300,
      );
      expect(scene.alignment.words.length).toBeGreaterThanOrEqual(18);
      expect(scene.alignment.words[0]?.word).toContain('[Valkyrie Lyra]');

      const wavInfo = parseWavHeader(scene.masterWav);
      expect(wavInfo.durationMs).toBeCloseTo(scene.durationMs, -2);
    });
  });
});
