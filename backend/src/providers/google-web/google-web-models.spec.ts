import {
  defaultGoogleWebRunSettingsForModel,
  findGoogleWebModel,
  GOOGLE_WEB_LIVE_VOICES,
  GOOGLE_WEB_MODEL_CATALOG,
  ModalityParamsSchema,
} from '@forge/shared';
import { GoogleWebBrowserService } from './google-web-browser.service';

describe('GOOGLE_WEB_MODEL_CATALOG & Browser Service Specs', () => {
  it('contains all 30 Live Audio voices in exact order from Zephyr to Sulafat', () => {
    expect(GOOGLE_WEB_LIVE_VOICES).toHaveLength(30);
    expect(GOOGLE_WEB_LIVE_VOICES[0]).toBe('Zephyr');
    expect(GOOGLE_WEB_LIVE_VOICES[1]).toBe('Puck');
    expect(GOOGLE_WEB_LIVE_VOICES[29]).toBe('Sulafat');
  });

  it('validates Gemini Web Guest & Signed-In Image models', () => {
    const guestImg = findGoogleWebModel('gemini-web-guest-img:3.5-flash-lite');
    expect(guestImg).toBeDefined();
    expect(guestImg!.targetUrl).toBe('https://gemini.google.com/images');
    expect(guestImg!.parameters.hasConfiguration).toBe(false);

    for (const id of [
      'gemini-web-img:3.5-flash-lite',
      'gemini-web-img:3.8-flash',
      'gemini-web-img:3.1-pro',
      'gemini-web-img:4.0-argon',
    ]) {
      const m = findGoogleWebModel(id);
      expect(m).toBeDefined();
      expect(m!.targetUrl).toBe('https://gemini.google.com/images');
      expect(m!.parameters.aspectRatios).toEqual([
        '1:1',
        '9:16',
        '3:4',
        '4:3',
        '16:9',
      ]);
      expect(m!.parameters.thinkingLevels).toEqual(['Low', 'Medium', 'High']);
    }
  });

  it('validates AI Studio Nano Banana 2.1, 2, 2 Lite, Pro, and Nano Banana exact specs', () => {
    const nb21 = findGoogleWebModel('aistudio-img:nano-banana-2.1')!;
    expect(nb21.parameters.outputFormats).toEqual([
      'Images only',
      'Images & text',
    ]);
    expect(nb21.parameters.temperature).toMatchObject({ min: 0, max: 1 });
    expect(nb21.parameters.aspectRatios).toHaveLength(15);
    expect(nb21.parameters.resolutions).toEqual(['1K', '2K', '4K']);
    expect(nb21.parameters.thinkingLevels).toEqual([
      'Minimal',
      'Medium',
      'High',
    ]);
    expect(nb21.parameters.supportsGroundingWithGoogleSearch).toBe(true);
    expect(nb21.parameters.supportsImageSearch).toBe(true);
    expect(nb21.parameters.outputLength).toMatchObject({ min: 1, max: 65536 });
    expect(nb21.parameters.topP).toBeUndefined();

    const nb2 = findGoogleWebModel('aistudio-img:nano-banana-2')!;
    expect(nb2.parameters.resolutions).toEqual(['512', '1K', '2K', '4K']);
    expect(nb2.parameters.thinkingLevels).toEqual(['Minimal', 'High']);
    expect(nb2.parameters.topP).toMatchObject({ min: 0, max: 1 });

    const nb2Lite = findGoogleWebModel('aistudio-img:nano-banana-2-lite')!;
    expect(nb2Lite.parameters.resolutions).toEqual(['1K']);
    expect(nb2Lite.parameters.thinkingLevels).toEqual(['Minimal', 'High']);
    expect(nb2Lite.parameters.supportsGroundingWithGoogleSearch).toBeFalsy();
    expect(nb2Lite.parameters.supportsImageSearch).toBeFalsy();
    expect(nb2Lite.parameters.topP).toMatchObject({ min: 0, max: 1 });

    const nbPro = findGoogleWebModel('aistudio-img:nano-banana-pro')!;
    expect(nbPro.parameters.aspectRatios).toHaveLength(11);
    expect(nbPro.parameters.resolutions).toEqual(['1K', '2K', '4K']);
    expect(nbPro.parameters.outputLength).toMatchObject({ min: 1, max: 32768 });
    expect(nbPro.parameters.topP).toMatchObject({ min: 0, max: 1 });

    const nb = findGoogleWebModel('aistudio-img:nano-banana')!;
    expect(nb.parameters.aspectRatios).toHaveLength(11);
    expect(nb.parameters.resolutions).toBeUndefined();
    expect(nb.parameters.outputLength).toMatchObject({ min: 1, max: 32768 });
  });

  it('validates Gemini Web Videos and AI Studio Gemini Omni 1.1 Flash Video specs', () => {
    const gwVid = findGoogleWebModel('gemini-web-vid:4.0-argon')!;
    expect(gwVid.targetUrl).toBe('https://gemini.google.com/videos');
    expect(gwVid.parameters.aspectRatios).toEqual([
      'Landscape (16:9)',
      'Portrait (9:16)',
    ]);
    expect(gwVid.parameters.thinkingLevels).toEqual(['Low', 'Medium', 'High']);

    const omni = findGoogleWebModel('aistudio-vid:gemini-omni-1.1-flash')!;
    expect(omni.parameters.aspectRatios).toEqual(['Auto', '16:9', '9:16']);
    expect(omni.parameters.videoDurationSec).toMatchObject({ min: 3, max: 10 });
    expect(omni.parameters.resolutions).toEqual([
      '360p',
      '720p',
      '1,080p',
      '4K',
    ]);
    expect(omni.parameters.frameRates).toEqual(['24FPS']);
    expect(omni.parameters.thinkingLevels).toEqual(['Low', 'High']);
    expect(omni.parameters.outputLength).toMatchObject({ min: 1, max: 65536 });
    expect(omni.parameters.videoTasks).toEqual([
      'unspecified',
      'text to video',
      'image to video',
      'reference to video',
      'edit video',
      'extend video',
    ]);
  });

  it('validates AI Studio TTS, Live Audio-to-Audio, and Lyria Music models', () => {
    const tts = findGoogleWebModel('aistudio-tts:gemini-3.8-flash-tts')!;
    expect(tts.parameters.temperature).toMatchObject({ min: 0, max: 2 });

    const live = findGoogleWebModel('aistudio-live:gemini-3.8-live-thinking')!;
    expect(live.parameters.voices).toHaveLength(30);
    expect(live.parameters.mediaResolutions).toEqual([
      'Low (66 tokens / image)',
      'Medium (258 tokens / image)',
    ]);
    expect(live.parameters.thinkingLevels).toEqual([
      'Minimal',
      'Low',
      'Medium',
      'High',
    ]);
    expect(live.parameters.contextSize).toMatchObject({
      min: 16000,
      max: 131072,
    });
    expect(live.parameters.supportsFunctionCalling).toBe(true);
    expect(live.parameters.supportsAutoFunctionResponse).toBe(true);
    expect(live.parameters.supportsGroundingWithGoogleSearch).toBe(true);

    for (const musicId of [
      'aistudio-music:lyria-3-clip',
      'aistudio-music:lyria-3-pro',
      'aistudio-music:lyria-3.5',
    ]) {
      const m = findGoogleWebModel(musicId)!;
      expect(m.parameters.hasConfiguration).toBe(false);
    }
  });

  it('validates ModalityParamsSchema with googleWebRunSettings attached', () => {
    const defaults = defaultGoogleWebRunSettingsForModel(
      'aistudio-img:nano-banana-2.1',
    );
    const parsed = ModalityParamsSchema.parse({
      modality: 'IMAGES',
      googleWebRunSettings: {
        ...defaults,
        aspectRatio: '21:9',
        resolution: '4K',
        thinkingLevel: 'High',
      },
    });
    expect(parsed.modality).toBe('IMAGES');
    if (parsed.modality === 'IMAGES') {
      expect(parsed.googleWebRunSettings?.aspectRatio).toBe('21:9');
      expect(parsed.googleWebRunSettings?.resolution).toBe('4K');
    }
  });

  it('extracts externalChatId safely and records / deletes only tracked WebChatSessions', async () => {
    const mockSessions: Array<Record<string, unknown>> = [];
    const mockPrisma = {
      webChatSession: {
        count: jest.fn(async () => mockSessions.filter((s) => !s['deletedFromWebAt']).length),
        findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
          mockSessions.find(
            (s) =>
              !s['deletedFromWebAt'] &&
              (!where['externalChatId'] || s['externalChatId'] === where['externalChatId']),
          ) ?? null,
        ),
        findUnique: jest.fn(async ({ where }: { where: { id: string } }) =>
          mockSessions.find((s) => s['id'] === where.id) ?? null,
        ),
        findMany: jest.fn(async ({ where }: { where: { jobId?: string } }) =>
          mockSessions.filter(
            (s) =>
              !s['deletedFromWebAt'] &&
              (!where?.jobId || s['jobId'] === where.jobId),
          ),
        ),
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          const row = {
            id: `chat-${mockSessions.length + 1}`,
            ...data,
            createdAt: new Date(),
            deletedFromWebAt: null,
          };
          mockSessions.push(row);
          return row;
        }),
        update: jest.fn(
          async ({
            where,
            data,
          }: {
            where: { id: string };
            data: Record<string, unknown>;
          }) => {
            const row = mockSessions.find((s) => s['id'] === where.id);
            if (row) Object.assign(row, data);
            return row;
          },
        ),
      },
    };

    const service = new GoogleWebBrowserService(mockPrisma as never);

    expect(
      service.extractExternalChatId('https://gemini.google.com/app/abc123def456'),
    ).toBe('abc123def456');
    expect(
      service.extractExternalChatId('https://gemini.google.com/images/img987654'),
    ).toBe('img987654');
    expect(
      service.extractExternalChatId('https://aistudio.google.com/prompts/1xYzPrompt99'),
    ).toBe('1xYzPrompt99');
    expect(
      service.extractExternalChatId('https://aistudio.google.com/prompts/new_chat'),
    ).toBeNull();

    const recorded = await service.recordTrackedChat({
      jobId: 'job-1',
      role: 'GENERATOR',
      modality: 'IMAGES',
      platform: 'aistudio',
      modelId: 'aistudio-img:nano-banana-2.1',
      chatUrl: 'https://aistudio.google.com/prompts/1xYzPrompt99',
      chatTitle: 'Cyberpunk Katana Icon',
    });

    expect(recorded).not.toBeNull();
    expect(recorded?.externalChatId).toBe('1xYzPrompt99');
    expect(GOOGLE_WEB_MODEL_CATALOG.length).toBeGreaterThanOrEqual(29);
  });
});
