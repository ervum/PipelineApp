import { HealthState, ProviderConfigModel, ProviderKind } from '@forge/shared';
import { GoogleGenAI } from '@google/genai';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { toProviderConfigModel } from '../common/mappers/provider.mapper';
import {
  JOB_EVENTS_PUBLISHER,
  JobEventsPublisherPort,
} from '../orchestrator/job-events.port';
import { PrismaService } from '../prisma/prisma.service';
import { GoogleWebBrowserService } from './google-web/google-web-browser.service';
import { ProviderRuntimeConfig, ProvidersService } from './providers.service';

const HEALTH_TIMEOUT_MS = 8_000;

interface ProbeOutcome {
  state: HealthState;
  latencyMs: number;
  message: string;
}

@Injectable()
export class ProviderHealthService {
  private readonly logger = new Logger(ProviderHealthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly providersService: ProvidersService,
    private readonly googleWebBrowser: GoogleWebBrowserService,
    @Inject(JOB_EVENTS_PUBLISHER) private readonly events: JobEventsPublisherPort,
  ) {}

  @Cron('*/2 * * * *')
  async checkAllEnabledCron(): Promise<void> {
    const enabled = await this.prisma.aiProviderConfig.findMany({
      where: { isEnabled: true },
      select: { id: true },
    });
    for (const row of enabled) {
      try {
        await this.check(row.id);
      } catch (err) {
        this.logger.warn(
          `Scheduled health check failed for provider ${row.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  async check(id: string): Promise<ProviderConfigModel> {
    const runtime = await this.providersService.getRuntimeConfig(id);
    const outcome = await this.probeProvider(runtime);

    const updated = await this.prisma.aiProviderConfig.update({
      where: { id },
      data: {
        healthState: outcome.state,
        healthLatencyMs: outcome.latencyMs,
        healthMessage: outcome.message,
        healthCheckedAt: new Date(),
      },
    });

    this.events.providerHealth({
      providerConfigId: id,
      state: outcome.state,
      latencyMs: outcome.latencyMs,
      message: outcome.message,
    });

    return toProviderConfigModel(updated);
  }

  private async probeProvider(cfg: ProviderRuntimeConfig): Promise<ProbeOutcome> {
    const started = Date.now();

    if (cfg.kind === ProviderKind.DEMO) {
      return {
        state: HealthState.HEALTHY,
        latencyMs: 1,
        message: 'Offline procedural engine ready',
      };
    }

    if (cfg.kind === ProviderKind.GOOGLE_WEB) {
      const authMode = cfg.settings.webAuthMode ?? 'aistudio';
      if (authMode === 'gemini_guest') {
        return {
          state: HealthState.HEALTHY,
          latencyMs: 2,
          message: 'Gemini Web Guest Mode ready (no sign-in required)',
        };
      }
      const status = await this.googleWebBrowser.getStatus();
      const latencyMs = Math.max(1, Date.now() - started);
      if (authMode === 'gemini_auth') {
        return {
          state: HealthState.HEALTHY,
          latencyMs,
          message: status.geminiAuthenticated
            ? 'Gemini Web persistent browser session authenticated'
            : 'Gemini Web browser ready (click Sign In if not yet authenticated)',
        };
      }
      return {
        state: HealthState.HEALTHY,
        latencyMs,
        message: status.aiStudioAuthenticated
          ? 'Google AI Studio persistent browser session authenticated'
          : 'Google AI Studio browser ready (click Sign In if not yet authenticated)',
      };
    }

    const requiresKey = (
      [
        ProviderKind.ANTHROPIC,
        ProviderKind.OPENAI,
        ProviderKind.GEMINI,
        ProviderKind.FAL,
        ProviderKind.REPLICATE,
        ProviderKind.STABILITY,
        ProviderKind.MESHY,
        ProviderKind.TRIPO3D,
        ProviderKind.RODIN,
        ProviderKind.ELEVENLABS,
        ProviderKind.CARTESIA,
        ProviderKind.FISH_AUDIO,
        ProviderKind.RUNPOD_SERVERLESS,
      ] as ProviderKind[]
    ).includes(cfg.kind);

    if (requiresKey && !cfg.secret) {
      return {
        state: HealthState.UNAUTHORIZED,
        latencyMs: 0,
        message: 'API key / secret is not configured',
      };
    }

    if (cfg.kind === ProviderKind.GEMINI) {
      try {
        const ai = new GoogleGenAI({ apiKey: cfg.secret! });
        const pager = await ai.models.list();
        void pager;
        return {
          state: HealthState.HEALTHY,
          latencyMs: Math.max(1, Date.now() - started),
          message: 'Gemini API reachable',
        };
      } catch (err) {
        const latencyMs = Math.max(1, Date.now() - started);
        const msg = err instanceof Error ? err.message : String(err);
        const isAuth = /401|403|api_key|permission|unauthenticated/i.test(msg);
        return {
          state: isAuth ? HealthState.UNAUTHORIZED : HealthState.UNREACHABLE,
          latencyMs,
          message: msg.slice(0, 240),
        };
      }
    }

    const trimBase = (u: string | null, fallback: string): string =>
      (u && u.trim().length > 0 ? u.trim() : fallback).replace(/\/+$/, '');

    let url = '';
    let method: 'GET' | 'POST' = 'GET';
    const headers: Record<string, string> = { ...cfg.extraHeaders };

    switch (cfg.kind) {
      case ProviderKind.ANTHROPIC:
        url = `${trimBase(cfg.baseUrl, 'https://api.anthropic.com')}/v1/models`;
        headers['x-api-key'] = cfg.secret!;
        headers['anthropic-version'] = '2023-06-01';
        break;
      case ProviderKind.OPENAI:
        url = `${trimBase(cfg.baseUrl, 'https://api.openai.com')}/v1/models`;
        headers['Authorization'] = `Bearer ${cfg.secret!}`;
        break;
      case ProviderKind.OPENAI_COMPATIBLE:
        url = `${trimBase(cfg.baseUrl, 'http://127.0.0.1:1234')}/v1/models`;
        if (cfg.secret) {
          headers['Authorization'] = `Bearer ${cfg.secret}`;
        }
        break;
      case ProviderKind.FAL:
        url = 'https://queue.fal.run/fal-ai/flux/dev/requests/healthcheck';
        headers['Authorization'] = `Key ${cfg.secret!}`;
        break;
      case ProviderKind.REPLICATE:
        url = 'https://api.replicate.com/v1/account';
        headers['Authorization'] = `Bearer ${cfg.secret!}`;
        break;
      case ProviderKind.STABILITY:
        url = 'https://api.stability.ai/v1/user/account';
        headers['Authorization'] = `Bearer ${cfg.secret!}`;
        break;
      case ProviderKind.MESHY:
        url = 'https://api.meshy.ai/openapi/v1/balance';
        headers['Authorization'] = `Bearer ${cfg.secret!}`;
        break;
      case ProviderKind.TRIPO3D:
        url = 'https://api.tripo3d.ai/v2/openapi/user/balance';
        headers['Authorization'] = `Bearer ${cfg.secret!}`;
        break;
      case ProviderKind.RODIN:
        url = `${trimBase(cfg.baseUrl, 'https://hyperhuman.deemos.com')}/api/v2/check_balance`;
        method = 'POST';
        headers['Authorization'] = `Bearer ${cfg.secret!}`;
        break;
      case ProviderKind.ELEVENLABS:
        url = 'https://api.elevenlabs.io/v1/user';
        headers['xi-api-key'] = cfg.secret!;
        break;
      case ProviderKind.CARTESIA:
        url = 'https://api.cartesia.ai/voices?limit=1';
        headers['X-API-Key'] = cfg.secret!;
        headers['Cartesia-Version'] = '2025-04-16';
        break;
      case ProviderKind.FISH_AUDIO:
        url = 'https://api.fish.audio/model?page_size=1';
        headers['Authorization'] = `Bearer ${cfg.secret!}`;
        break;
      case ProviderKind.RUNPOD_SERVERLESS:
        url = `https://api.runpod.ai/v2/${cfg.runpodEndpointId ?? ''}/health`;
        headers['Authorization'] = `Bearer ${cfg.secret!}`;
        break;
      case ProviderKind.COMFYUI:
        url = `${trimBase(cfg.baseUrl, 'http://127.0.0.1:8188')}/system_stats`;
        break;
      case ProviderKind.A1111:
        url = `${trimBase(cfg.baseUrl, 'http://127.0.0.1:7860')}/sdapi/v1/options`;
        break;
      case ProviderKind.OLLAMA:
        url = `${trimBase(cfg.baseUrl, 'http://127.0.0.1:11434')}/api/tags`;
        break;
      case ProviderKind.GENERIC_HTTP:
        url = trimBase(cfg.baseUrl, 'http://127.0.0.1:7865');
        if (cfg.secret) {
          headers['Authorization'] = `Bearer ${cfg.secret}`;
        }
        break;
    }

    try {
      const res = await fetch(url, {
        method,
        headers,
        signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
      });
      const latencyMs = Math.max(1, Date.now() - started);

      if (res.status === 401 || res.status === 403) {
        return {
          state: HealthState.UNAUTHORIZED,
          latencyMs,
          message: `HTTP ${res.status} Unauthorized`,
        };
      }

      if (cfg.kind === ProviderKind.FAL && (res.status === 200 || res.status === 404)) {
        return {
          state: HealthState.HEALTHY,
          latencyMs,
          message: 'Fal.ai queue reachable and credentials accepted',
        };
      }

      if (cfg.kind === ProviderKind.GENERIC_HTTP && res.status < 500) {
        return {
          state: HealthState.HEALTHY,
          latencyMs,
          message: `HTTP ${res.status} reachable`,
        };
      }

      if (!res.ok) {
        return {
          state: res.status >= 500 ? HealthState.UNREACHABLE : HealthState.DEGRADED,
          latencyMs,
          message: `HTTP ${res.status} ${res.statusText}`,
        };
      }

      if (cfg.kind === ProviderKind.RUNPOD_SERVERLESS) {
        const body = (await res.json()) as {
          workers?: {
            idle?: number;
            running?: number;
            initializing?: number;
            throttled?: number;
          };
        };
        const throttled = body.workers?.throttled ?? 0;
        const idle = body.workers?.idle ?? 0;
        const running = body.workers?.running ?? 0;
        if (throttled > 0) {
          return {
            state: HealthState.DEGRADED,
            latencyMs,
            message: `RunPod workers throttled (${throttled} throttled, ${running} running, ${idle} idle)`,
          };
        }
        return {
          state: HealthState.HEALTHY,
          latencyMs,
          message: `RunPod endpoint healthy (${running} running, ${idle} idle)`,
        };
      }

      return {
        state: HealthState.HEALTHY,
        latencyMs,
        message: 'Endpoint healthy',
      };
    } catch (err) {
      const latencyMs = Math.max(1, Date.now() - started);
      return {
        state: HealthState.UNREACHABLE,
        latencyMs,
        message: err instanceof Error ? err.message.slice(0, 240) : 'Connection failed',
      };
    }
  }
}
