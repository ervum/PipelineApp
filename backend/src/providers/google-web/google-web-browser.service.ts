import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { WebChatSession } from '@prisma/client';
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { BrowserContext, Page } from 'playwright-core';
import { chromium } from 'playwright-core';
import { PrismaService } from '../../prisma/prisma.service';

export interface GoogleWebStatusDto {
  geminiAuthenticated: boolean;
  aiStudioAuthenticated: boolean;
  browserRunning: boolean;
  browserVisible: boolean;
  activeJobs: string[];
  trackedChatsCount: number;
}

export interface RecordWebChatParams {
  providerConfigId?: string | null;
  projectId?: string | null;
  jobId?: string | null;
  role: 'MIDDLEMAN' | 'GENERATOR';
  modality?: string | null;
  platform: 'gemini' | 'aistudio';
  modelId: string;
  chatUrl: string;
  externalChatId?: string | null;
  chatTitle?: string | null;
}

@Injectable()
export class GoogleWebBrowserService implements OnApplicationShutdown {
  private readonly logger = new Logger(GoogleWebBrowserService.name);
  private sharedContext: BrowserContext | null = null;
  private contextLaunchPromise: Promise<BrowserContext> | null = null;
  private browserVisible = false;
  private defaultHeadless = true;
  private geminiAuthenticatedCache = false;
  private aiStudioAuthenticatedCache = false;

  readonly activeGenerationPages = new Map<string, Page>();

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationShutdown(): Promise<void> {
    await this.closeBrowser();
  }

  getProfileDir(): string {
    const dir = resolve(process.cwd(), '.browser-profiles', 'google-shared');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  findSystemBrowserExecutable(): string | undefined {
    const localAppData = process.env['LOCALAPPDATA'] ?? '';
    const programFiles = process.env['PROGRAMFILES'] ?? 'C:\\Program Files';
    const programFilesX86 =
      process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)';

    const candidates = [
      join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      localAppData
        ? join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe')
        : '',
      join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    ].filter((p) => p.length > 0);

    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        return candidate;
      }
    }
    return undefined;
  }

  private isContextAlive(ctx: BrowserContext | null): ctx is BrowserContext {
    if (!ctx) return false;
    try {
      // Accessing pages() throws or returns empty if browser process died
      void ctx.pages();
      const browser = ctx.browser();
      if (browser && !browser.isConnected()) {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Single Persistent Browser Instance & Mutex:
   * Never opens a second browser if one is already running or launching.
   */
  async ensureSharedContext(preferVisible?: boolean): Promise<BrowserContext> {
    if (this.isContextAlive(this.sharedContext)) {
      if (preferVisible !== undefined && preferVisible !== this.browserVisible) {
        await this.setBrowserVisibility(preferVisible);
      }
      return this.sharedContext;
    }

    if (this.contextLaunchPromise) {
      const ctx = await this.contextLaunchPromise;
      if (this.isContextAlive(ctx)) {
        if (preferVisible !== undefined && preferVisible !== this.browserVisible) {
          await this.setBrowserVisibility(preferVisible);
        }
        return ctx;
      }
    }

    const startVisible =
      preferVisible !== undefined ? preferVisible : !this.defaultHeadless;

    this.contextLaunchPromise = (async () => {
      const profileDir = this.getProfileDir();
      const executablePath = this.findSystemBrowserExecutable();
      const positionArg = startVisible
        ? '--window-position=80,60'
        : '--window-position=-32000,-32000';

      this.logger.log(
        `Launching single persistent Google Web browser context (visible=${startVisible}, profile=${profileDir})`,
      );

      const ctx = await chromium.launchPersistentContext(profileDir, {
        headless: false,
        executablePath,
        ignoreDefaultArgs: ['--no-sandbox', '--enable-automation'],
        args: [
          positionArg,
          '--window-size=1280,900',
          '--disable-blink-features=AutomationControlled',
          '--disable-infobars',
          '--no-first-run',
          '--no-default-browser-check',
        ],
        viewport: { width: 1280, height: 860 },
      });

      ctx.on('close', () => {
        this.logger.warn('Persistent Google Web browser context was closed');
        this.sharedContext = null;
        this.contextLaunchPromise = null;
        this.browserVisible = false;
        this.activeGenerationPages.clear();
      });

      this.sharedContext = ctx;
      this.browserVisible = startVisible;

      // Apply CDP bounds to ensure off-screen or visible state matches
      await this.applyWindowVisibilityCdp(ctx, startVisible).catch(() => undefined);

      return ctx;
    })();

    try {
      return await this.contextLaunchPromise;
    } catch (err) {
      this.sharedContext = null;
      this.contextLaunchPromise = null;
      throw err;
    } finally {
      this.contextLaunchPromise = null;
    }
  }

  /**
   * Auto-Recovery on Closed Browser + Blank Tab Cleanup:
   * Reuses an existing unused about:blank tab if available so no extra blank tab is left open,
   * and automatically relaunches the persistent context if the user manually closed the browser.
   */
  async openPageWithRecovery(options?: {
    headless?: boolean;
    trackingKey?: string;
  }): Promise<Page> {
    if (options?.headless !== undefined) {
      this.defaultHeadless = options.headless;
    }
    const wantVisible =
      options?.headless === false ? true : this.browserVisible;

    const tryAcquirePage = async (): Promise<Page> => {
      const ctx = await this.ensureSharedContext(wantVisible);
      const existingPages = ctx.pages();
      const activeTrackedPages = new Set(this.activeGenerationPages.values());

      // Reuse an existing about:blank tab if not currently in use
      const blankPage = existingPages.find(
        (p) =>
          !p.isClosed() &&
          !activeTrackedPages.has(p) &&
          (p.url() === 'about:blank' || p.url() === 'chrome://newtab/'),
      );

      let page: Page;
      if (blankPage) {
        page = blankPage;
      } else {
        page = await ctx.newPage();
      }

      // Close any leftover extra about:blank pages
      for (const p of ctx.pages()) {
        if (
          p !== page &&
          !p.isClosed() &&
          !activeTrackedPages.has(p) &&
          (p.url() === 'about:blank' || p.url() === 'chrome://newtab/')
        ) {
          await p.close().catch(() => undefined);
        }
      }

      return page;
    };

    let page: Page;
    try {
      page = await tryAcquirePage();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Browser page open failed (${msg}); resetting context and recovering...`,
      );
      this.sharedContext = null;
      this.contextLaunchPromise = null;
      page = await tryAcquirePage();
    }

    if (options?.trackingKey) {
      this.activeGenerationPages.set(options.trackingKey, page);
      page.once('close', () => {
        if (this.activeGenerationPages.get(options.trackingKey!) === page) {
          this.activeGenerationPages.delete(options.trackingKey!);
        }
      });
    }

    return page;
  }

  releasePage(trackingKey?: string, page?: Page, closePage = true): void {
    if (trackingKey) {
      this.activeGenerationPages.delete(trackingKey);
    }
    if (page && closePage && !page.isClosed()) {
      const ctx = this.sharedContext;
      // Keep at least 1 tab open in persistent context so Chrome doesn't exit the process
      if (ctx && ctx.pages().length > 1) {
        void page.close().catch(() => undefined);
      } else if (ctx && ctx.pages().length === 1) {
        void page.goto('about:blank').catch(() => undefined);
      }
    }
  }

  getBrowserVisibility(): boolean {
    return this.browserVisible && this.isContextAlive(this.sharedContext);
  }

  async setBrowserVisibility(visible: boolean): Promise<{ visible: boolean }> {
    this.browserVisible = visible;
    const ctx = await this.ensureSharedContext(visible);
    await this.applyWindowVisibilityCdp(ctx, visible);
    return { visible: this.browserVisible };
  }

  private async applyWindowVisibilityCdp(
    ctx: BrowserContext,
    visible: boolean,
  ): Promise<void> {
    const pages = ctx.pages().filter((p) => !p.isClosed());
    const targetPage = pages[0] ?? (await ctx.newPage());
    const cdp = await ctx.newCDPSession(targetPage);
    try {
      const { windowId } = (await cdp.send('Browser.getWindowForTarget')) as {
        windowId: number;
      };
      if (visible) {
        await cdp.send('Browser.setWindowBounds', {
          windowId,
          bounds: { windowState: 'normal' },
        });
        await cdp.send('Browser.setWindowBounds', {
          windowId,
          bounds: {
            left: 80,
            top: 60,
            width: 1280,
            height: 900,
            windowState: 'normal',
          },
        });
        await targetPage.bringToFront().catch(() => undefined);
      } else {
        await cdp.send('Browser.setWindowBounds', {
          windowId,
          bounds: {
            left: -32000,
            top: -32000,
            width: 1280,
            height: 900,
            windowState: 'normal',
          },
        });
      }
    } finally {
      await cdp.detach().catch(() => undefined);
    }
  }

  /**
   * Clicks Gemini Web's "Answer now" / "Skip thinking" button in the active generation page
   * to stop recursive thinking and immediately start generating output.
   */
  async triggerAnswerNow(jobId?: string): Promise<{ clicked: boolean; message: string }> {
    const candidatePages: Page[] = [];
    if (jobId && this.activeGenerationPages.has(jobId)) {
      candidatePages.push(this.activeGenerationPages.get(jobId)!);
    }
    for (const p of this.activeGenerationPages.values()) {
      if (!candidatePages.includes(p)) {
        candidatePages.push(p);
      }
    }
    if (this.isContextAlive(this.sharedContext)) {
      for (const p of this.sharedContext.pages()) {
        if (!candidatePages.includes(p)) {
          candidatePages.push(p);
        }
      }
    }

    const selectors = [
      'button:has-text("Answer now")',
      'button:has-text("Skip thinking")',
      'button[aria-label*="Answer now" i]',
      'button[aria-label*="Skip thinking" i]',
      '[role="button"]:has-text("Answer now")',
    ];

    for (const page of candidatePages) {
      if (page.isClosed()) continue;
      for (const sel of selectors) {
        try {
          const loc = page.locator(sel).first();
          if ((await loc.count()) > 0 && (await loc.isVisible())) {
            await loc.click({ timeout: 2000 });
            this.logger.log(`Clicked "Answer now" button via selector ${sel}`);
            return {
              clicked: true,
              message: 'Clicked "Answer now" — Gemini is finalizing its answer immediately.',
            };
          }
        } catch {
          // Try next selector
        }
      }
    }

    return {
      clicked: false,
      message: 'No active "Answer now" thinking button is currently visible on the page.',
    };
  }

  async openInteractiveLogin(
    target: 'gemini' | 'aistudio' = 'aistudio',
  ): Promise<{ url: string; visible: boolean }> {
    await this.setBrowserVisibility(true);
    const page = await this.openPageWithRecovery({ headless: false });
    const url =
      target === 'gemini'
        ? 'https://gemini.google.com/app'
        : 'https://aistudio.google.com/prompts/new_chat';
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.bringToFront().catch(() => undefined);
    return { url, visible: true };
  }

  async getStatus(): Promise<GoogleWebStatusDto> {
    if (this.isContextAlive(this.sharedContext)) {
      try {
        const cookies = await this.sharedContext.cookies([
          'https://google.com',
          'https://gemini.google.com',
          'https://aistudio.google.com',
        ]);
        const hasGoogleSession = cookies.some(
          (c) =>
            (c.name === 'SID' ||
              c.name === '__Secure-1PSID' ||
              c.name === '__Secure-3PSID') &&
            Boolean(c.value),
        );
        this.geminiAuthenticatedCache = hasGoogleSession;
        this.aiStudioAuthenticatedCache = hasGoogleSession;
      } catch {
        // Ignore cookie check failure
      }
    }

    const trackedChatsCount = await this.prisma.webChatSession.count({
      where: { deletedFromWebAt: null },
    });

    return {
      geminiAuthenticated: this.geminiAuthenticatedCache,
      aiStudioAuthenticated: this.aiStudioAuthenticatedCache,
      browserRunning: this.isContextAlive(this.sharedContext),
      browserVisible: this.getBrowserVisibility(),
      activeJobs: Array.from(this.activeGenerationPages.keys()),
      trackedChatsCount,
    };
  }

  extractExternalChatId(chatUrl: string): string | null {
    try {
      const u = new URL(chatUrl);
      // Gemini Web: /app/<id>, /images/<id>, /videos/<id>
      const geminiMatch = /^\/(?:app|images|videos)\/([a-zA-Z0-9_-]{6,})/.exec(
        u.pathname,
      );
      if (geminiMatch?.[1]) {
        return geminiMatch[1];
      }
      // AI Studio: /prompts/<id> (excluding new_chat)
      const aiStudioMatch = /^\/prompts\/([a-zA-Z0-9_-]{6,})/.exec(u.pathname);
      if (aiStudioMatch?.[1] && aiStudioMatch[1] !== 'new_chat') {
        return aiStudioMatch[1];
      }
      return null;
    } catch {
      return null;
    }
  }

  async recordTrackedChat(params: RecordWebChatParams): Promise<WebChatSession | null> {
    const externalChatId =
      params.externalChatId ?? this.extractExternalChatId(params.chatUrl);
    if (!externalChatId) {
      return null;
    }

    const existing = await this.prisma.webChatSession.findFirst({
      where: {
        platform: params.platform,
        externalChatId,
        deletedFromWebAt: null,
      },
    });
    if (existing) {
      return existing;
    }

    return this.prisma.webChatSession.create({
      data: {
        providerConfigId: params.providerConfigId ?? null,
        projectId: params.projectId ?? null,
        jobId: params.jobId ?? null,
        role: params.role,
        modality: params.modality ?? null,
        platform: params.platform,
        modelId: params.modelId,
        chatUrl: params.chatUrl,
        externalChatId,
        chatTitle: params.chatTitle ?? null,
      },
    });
  }

  async listTrackedChats(limit = 50): Promise<WebChatSession[]> {
    return this.prisma.webChatSession.findMany({
      where: { deletedFromWebAt: null },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  /**
   * Strict Safety Guarantee:
   * Navigates directly to the exact tracked `chatUrl` and verifies `externalChatId` in the URL
   * before opening that specific chat's delete action. Never deletes untracked user chats.
   */
  private async deleteChatFromWeb(session: WebChatSession): Promise<boolean> {
    if (!session.externalChatId) {
      return false;
    }
    const page = await this.openPageWithRecovery();
    try {
      await page.goto(session.chatUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      await page.waitForTimeout(1500);

      const currentUrl = page.url();
      if (!currentUrl.includes(session.externalChatId)) {
        this.logger.warn(
          `Aborted web chat deletion: current URL (${currentUrl}) does not contain tracked externalChatId (${session.externalChatId})`,
        );
        return false;
      }

      if (session.platform === 'gemini') {
        const menuSelectors = [
          'button[aria-label*="More options" i]',
          'button[aria-label*="Conversation actions" i]',
          'button[data-test-id="actions-menu-button"]',
        ];
        for (const sel of menuSelectors) {
          const btn = page.locator(sel).first();
          if ((await btn.count()) > 0 && (await btn.isVisible())) {
            await btn.click({ timeout: 2000 }).catch(() => undefined);
            break;
          }
        }
        const deleteItem = page
          .locator(
            '[role="menuitem"]:has-text("Delete"), button:has-text("Delete")',
          )
          .first();
        if ((await deleteItem.count()) > 0 && (await deleteItem.isVisible())) {
          await deleteItem.click({ timeout: 2000 });
          const confirmBtn = page
            .locator(
              'mat-dialog-container button:has-text("Delete"), [role="dialog"] button:has-text("Delete")',
            )
            .first();
          if ((await confirmBtn.count()) > 0) {
            await confirmBtn.click({ timeout: 3000 });
          }
        }
      } else {
        // AI Studio prompt deletion for the active prompt URL
        const moreBtn = page
          .locator(
            'button[aria-label*="More" i], button[aria-label*="Prompt options" i]',
          )
          .first();
        if ((await moreBtn.count()) > 0 && (await moreBtn.isVisible())) {
          await moreBtn.click({ timeout: 2000 }).catch(() => undefined);
          const delOption = page
            .locator('[role="menuitem"]:has-text("Delete")')
            .first();
          if ((await delOption.count()) > 0) {
            await delOption.click({ timeout: 2000 });
            const confirmBtn = page
              .locator('[role="dialog"] button:has-text("Delete")')
              .first();
            if ((await confirmBtn.count()) > 0) {
              await confirmBtn.click({ timeout: 3000 });
            }
          }
        }
      }
      return true;
    } catch (err) {
      this.logger.warn(
        `Best-effort web deletion warning for chat ${session.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    } finally {
      this.releasePage(undefined, page, true);
    }
  }

  async deleteWebChatById(chatId: string): Promise<{ deleted: boolean }> {
    const session = await this.prisma.webChatSession.findUnique({
      where: { id: chatId },
    });
    if (!session || session.deletedFromWebAt) {
      return { deleted: false };
    }
    await this.deleteChatFromWeb(session);
    await this.prisma.webChatSession.update({
      where: { id: session.id },
      data: { deletedFromWebAt: new Date() },
    });
    return { deleted: true };
  }

  async deleteWebChatsForJob(jobId: string): Promise<{ deletedCount: number }> {
    const sessions = await this.prisma.webChatSession.findMany({
      where: { jobId, deletedFromWebAt: null },
    });
    let deletedCount = 0;
    for (const s of sessions) {
      await this.deleteChatFromWeb(s);
      await this.prisma.webChatSession.update({
        where: { id: s.id },
        data: { deletedFromWebAt: new Date() },
      });
      deletedCount += 1;
    }
    return { deletedCount };
  }

  async deleteLastRunWebChats(): Promise<{ deletedCount: number }> {
    const latest = await this.prisma.webChatSession.findFirst({
      where: { deletedFromWebAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!latest) {
      return { deletedCount: 0 };
    }
    if (latest.jobId) {
      return this.deleteWebChatsForJob(latest.jobId);
    }
    await this.deleteWebChatById(latest.id);
    return { deletedCount: 1 };
  }

  async deleteAllTrackedWebChats(): Promise<{ deletedCount: number }> {
    const sessions = await this.prisma.webChatSession.findMany({
      where: { deletedFromWebAt: null },
      orderBy: { createdAt: 'desc' },
    });
    let deletedCount = 0;
    for (const s of sessions) {
      await this.deleteChatFromWeb(s);
      await this.prisma.webChatSession.update({
        where: { id: s.id },
        data: { deletedFromWebAt: new Date() },
      });
      deletedCount += 1;
    }
    return { deletedCount };
  }

  async closeBrowser(): Promise<void> {
    this.activeGenerationPages.clear();
    if (this.sharedContext) {
      await this.sharedContext.close().catch(() => undefined);
      this.sharedContext = null;
    }
    this.contextLaunchPromise = null;
  }
}
