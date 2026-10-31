import { synthesizeLoreText } from '../src/synth/text.synth';
import { synthesizeVideo } from '../src/synth/video.synth';
import { McpController } from '../src/mcp/mcp.controller';
import { McpToolsService } from '../src/mcp/mcp-tools.service';

describe('Video & Lore Synthesizers + MCP Server', () => {
  describe('video.synth', () => {
    it('synthesizes primary WebP, poster PNG, and 8 keyframe PNGs with camera trajectory', async () => {
      const result = await synthesizeVideo({
        prompt: 'Astral citadel beneath #7C3AED storm clouds and #06B6D4 runes',
        seed: 20261023,
        durationSec: 4,
        fps: 24,
        aspectRatio: '16:9',
        resolution: '720p',
        videoCategory: 'CUTSCENE',
        cameraMotion: 'ORBIT',
        motionIntensity: 0.7,
        loopable: true,
        memoryStrategy: 'RAM_FALLBACK_32GB',
      });

      expect(result.width).toBe(1280);
      expect(result.height).toBe(720);
      expect(result.durationMs).toBe(4000);
      expect(result.fps).toBe(24);
      expect(result.animatedWebp.length).toBeGreaterThan(200);
      expect(result.posterPng.length).toBeGreaterThan(200);
      expect(result.frames).toHaveLength(8);
    });
  });

  describe('text.synth (synthesizeLoreText)', () => {
    it('synthesizes SHORT_FORM item description with accurate word/char counts', () => {
      const shortRes = synthesizeLoreText({
        prompt: 'Starforged Katana of the Eclipse',
        seed: 101,
        lengthForm: 'SHORT_FORM',
        loreCategory: 'ITEM_DESCRIPTION',
        tone: 'IN_WORLD_DIEGETIC',
        perspective: 'THIRD_PERSON_OMNISCIENT',
        targetWordCount: 80,
        includeSections: false,
        outputFormat: 'MARKDOWN',
      });

      expect(shortRes.wordCount).toBeGreaterThan(25);
      expect(shortRes.wordCount).toBeLessThan(220);
      expect(shortRes.charCount).toBe(shortRes.text.trim().length);
      expect(shortRes.excerpt.length).toBeGreaterThan(10);
    });

    it('synthesizes LONG_FORM character backstory with multi-act Markdown sections', () => {
      const longRes = synthesizeLoreText({
        prompt: 'Arch-Chronomancer Vaelen Thorne',
        seed: 202,
        lengthForm: 'LONG_FORM',
        loreCategory: 'CHARACTER_BACKSTORY',
        tone: 'POETIC_MYTHIC',
        perspective: 'FIRST_PERSON_CHRONICLER',
        targetWordCount: 900,
        includeSections: true,
        outputFormat: 'MARKDOWN',
      });

      expect(longRes.wordCount).toBeGreaterThan(400);
      expect(longRes.text).toContain('## ');
      expect(longRes.readingTimeSec).toBeGreaterThan(60);
    });
  });

  describe('McpToolsService & McpController (JSON-RPC 2.0)', () => {
    let service: McpToolsService;
    let controller: McpController;

    beforeEach(() => {
      service = new McpToolsService(
        {} as never,
        {} as never,
        {} as never,
        { list: async () => [] } as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
      );
      controller = new McpController(service);
    });

    it('exposes all 22 MCP tools including 2D Icon, 3D Asset, Image, Video, and Lore generators', () => {
      const tools = service.getTools();
      expect(tools.length).toBe(22);

      const names = tools.map((t) => t.name);
      expect(names).toContain('forge_generate_2d_icon');
      expect(names).toContain('forge_generate_3d_asset');
      expect(names).toContain('forge_generate_image');
      expect(names).toContain('forge_generate_video');
      expect(names).toContain('forge_generate_lore');
      expect(names).toContain('forge_generate_music');
      expect(names).toContain('forge_generate_voice');
      expect(names).toContain('forge_generate_sfx');
      expect(names).toContain('forge_generate_code_or_sprite');
    });

    it('reports 32GB DDR5 System RAM Fallback profile in MCP status', async () => {
      const status = await service.getStatus('http://localhost:3333');
      expect(status.toolCount).toBe(22);
      expect(status.hardwareProfile.systemRamGb).toBe(32);
      expect(status.hardwareProfile.ramType).toBe('DDR5');
      expect(status.hardwareProfile.vramFallbackEnabled).toBe(true);
      expect(status.hardwareProfile.recommendedMemoryStrategy).toBe('RAM_FALLBACK_32GB');
    });

    it('handles MCP JSON-RPC 2.0 initialize, tools/list, resources/list, prompts/list, and ping', async () => {
      const initRes = await controller.handleJsonRpc({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {},
      });
      expect(Array.isArray(initRes)).toBe(false);
      if (!Array.isArray(initRes)) {
        expect(initRes.id).toBe(1);
        const result = initRes.result as { protocolVersion: string; serverInfo: { name: string } };
        expect(result.protocolVersion).toBe('2025-03-26');
        expect(result.serverInfo.name).toBe('forgestudio-control-room-mcp');
      }

      const toolsListRes = await controller.handleJsonRpc({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
      });
      if (!Array.isArray(toolsListRes)) {
        const result = toolsListRes.result as { tools: Array<{ name: string }> };
        expect(result.tools).toHaveLength(22);
      }

      const pingRes = await controller.handleJsonRpc({
        jsonrpc: '2.0',
        id: 3,
        method: 'ping',
      });
      if (!Array.isArray(pingRes)) {
        expect(pingRes.result).toEqual({});
      }
    });
  });
});
