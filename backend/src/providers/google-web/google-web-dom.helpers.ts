import {
  GoogleWebModelDefinition,
  GoogleWebRunSettings,
} from '@forge/shared';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from 'playwright-core';

export interface TempAttachment {
  buffer: Buffer;
  mimeType: string;
  fileName: string;
}

export async function dismissGoogleBanners(page: Page): Promise<void> {
  const dismissSelectors = [
    'button:has-text("Accept all")',
    'button:has-text("I agree")',
    'button:has-text("Got it")',
    'button:has-text("Dismiss")',
    'button:has-text("No thanks")',
    'button:has-text("Continue as guest")',
    'button[aria-label="Close" i]',
  ];
  for (const sel of dismissSelectors) {
    try {
      const btn = page.locator(sel).first();
      if ((await btn.count()) > 0 && (await btn.isVisible())) {
        await btn.click({ timeout: 1200 }).catch(() => undefined);
      }
    } catch {
      // Ignore
    }
  }
}

export async function configureGeminiWebControls(
  page: Page,
  model: GoogleWebModelDefinition,
  settings?: GoogleWebRunSettings,
): Promise<void> {
  await dismissGoogleBanners(page);

  // Guest Mode has no configuration options (thinking is automatic)
  if (model.authMode === 'gemini_guest' || !model.parameters.hasConfiguration) {
    return;
  }

  // 1. Select Model in Gemini Web picker if Signed-In
  const modelPickerTrigger = page
    .locator(
      'button[data-test-id="bard-mode-menu-button"], button[aria-label*="model" i], [data-test-id="model-selector"]',
    )
    .first();
  if (
    (await modelPickerTrigger.count()) > 0 &&
    (await modelPickerTrigger.isVisible())
  ) {
    await modelPickerTrigger.click({ timeout: 2500 }).catch(() => undefined);
    const option = page
      .locator(
        `[role="menuitem"]:has-text("${model.pickerLabel}"), button:has-text("${model.pickerLabel}")`,
      )
      .first();
    if ((await option.count()) > 0 && (await option.isVisible())) {
      await option.click({ timeout: 2000 }).catch(() => undefined);
    } else {
      await page.keyboard.press('Escape').catch(() => undefined);
    }
  }

  // 2. Select Aspect Ratio if supported (Gemini Web Images or Videos)
  if (settings?.aspectRatio && model.parameters.aspectRatios?.length) {
    const ratioBtn = page
      .locator(
        `button:has-text("${settings.aspectRatio}"), [role="option"]:has-text("${settings.aspectRatio}"), button[aria-label*="${settings.aspectRatio}" i]`,
      )
      .first();
    if ((await ratioBtn.count()) > 0 && (await ratioBtn.isVisible())) {
      await ratioBtn.click({ timeout: 2000 }).catch(() => undefined);
    }
  }

  // 3. Select Thinking Level if supported (Low, Medium, High)
  if (settings?.thinkingLevel && model.parameters.thinkingLevels?.length) {
    const thinkingBtn = page
      .locator(
        `button[aria-label*="Thinking" i], button:has-text("Thinking"), [data-test-id*="thinking"]`,
      )
      .first();
    if ((await thinkingBtn.count()) > 0 && (await thinkingBtn.isVisible())) {
      await thinkingBtn.click({ timeout: 2000 }).catch(() => undefined);
      const levelOpt = page
        .locator(
          `[role="menuitem"]:has-text("${settings.thinkingLevel}"), button:has-text("${settings.thinkingLevel}")`,
        )
        .first();
      if ((await levelOpt.count()) > 0) {
        await levelOpt.click({ timeout: 2000 }).catch(() => undefined);
      }
    }
  }
}

export async function configureAiStudioRunSettings(
  page: Page,
  model: GoogleWebModelDefinition,
  settings?: GoogleWebRunSettings,
): Promise<void> {
  await dismissGoogleBanners(page);
  if (!model.parameters.hasConfiguration || !settings) {
    return;
  }

  const p = model.parameters;

  // Ensure Run settings panel is open
  const runSettingsToggle = page
    .locator(
      'button[aria-label*="Run settings" i], button:has-text("Run settings")',
    )
    .first();
  if (
    (await runSettingsToggle.count()) > 0 &&
    (await runSettingsToggle.isVisible())
  ) {
    const expanded = await runSettingsToggle.getAttribute('aria-expanded');
    if (expanded === 'false') {
      await runSettingsToggle.click({ timeout: 2000 }).catch(() => undefined);
    }
  }

  const selectDropdownValue = async (
    labelPattern: string,
    optionText: string,
  ): Promise<void> => {
    const trigger = page
      .locator(
        `mat-select[aria-label*="${labelPattern}" i], [aria-label*="${labelPattern}" i][role="combobox"], button[aria-label*="${labelPattern}" i]`,
      )
      .first();
    if ((await trigger.count()) > 0 && (await trigger.isVisible())) {
      await trigger.click({ timeout: 2000 }).catch(() => undefined);
      const opt = page
        .locator(
          `mat-option:has-text("${optionText}"), [role="option"]:has-text("${optionText}")`,
        )
        .first();
      if ((await opt.count()) > 0) {
        await opt.click({ timeout: 2000 }).catch(() => undefined);
      } else {
        await page.keyboard.press('Escape').catch(() => undefined);
      }
    }
  };

  const setNumericInput = async (
    labelPattern: string,
    value: number,
  ): Promise<void> => {
    const input = page
      .locator(
        `input[aria-label*="${labelPattern}" i], [data-test-id*="${labelPattern}" i] input`,
      )
      .first();
    if ((await input.count()) > 0 && (await input.isVisible())) {
      await input.fill(String(value)).catch(() => undefined);
      await input.dispatchEvent('change').catch(() => undefined);
    }
  };

  const setToggleSwitch = async (
    labelPattern: string,
    enabled: boolean,
  ): Promise<void> => {
    const toggle = page
      .locator(
        `mat-slide-toggle:has-text("${labelPattern}") button[role="switch"], button[role="switch"][aria-label*="${labelPattern}" i]`,
      )
      .first();
    if ((await toggle.count()) > 0 && (await toggle.isVisible())) {
      const checked = await toggle.getAttribute('aria-checked');
      if ((checked === 'true') !== enabled) {
        await toggle.click({ timeout: 2000 }).catch(() => undefined);
      }
    }
  };

  if (settings.outputFormat && p.outputFormats?.includes(settings.outputFormat)) {
    await selectDropdownValue('Output format', settings.outputFormat);
  }

  if (settings.temperature !== undefined && p.temperature) {
    const clamped = Math.min(
      p.temperature.max,
      Math.max(p.temperature.min, settings.temperature),
    );
    await setNumericInput('Temperature', clamped);
  }

  if (settings.aspectRatio && p.aspectRatios?.includes(settings.aspectRatio)) {
    await selectDropdownValue('Aspect ratio', settings.aspectRatio);
  }

  if (settings.resolution && p.resolutions?.includes(settings.resolution)) {
    await selectDropdownValue('Resolution', settings.resolution);
  }

  if (settings.thinkingLevel && p.thinkingLevels?.includes(settings.thinkingLevel)) {
    await selectDropdownValue('Thinking level', settings.thinkingLevel);
  }

  if (
    settings.mediaResolution &&
    p.mediaResolutions?.includes(settings.mediaResolution)
  ) {
    await selectDropdownValue('Media resolution', settings.mediaResolution);
  }

  if (
    settings.groundingWithGoogleSearch !== undefined &&
    p.supportsGroundingWithGoogleSearch
  ) {
    await setToggleSwitch(
      'Grounding with Google Search',
      settings.groundingWithGoogleSearch,
    );
  }

  if (settings.imageSearch !== undefined && p.supportsImageSearch) {
    await setToggleSwitch('Image Search', settings.imageSearch);
  }

  if (settings.structuredOutputs !== undefined && p.supportsStructuredOutputs) {
    await setToggleSwitch('Structured Outputs', settings.structuredOutputs);
  }

  if (settings.codeExecution !== undefined && p.supportsCodeExecution) {
    await setToggleSwitch('Code Execution', settings.codeExecution);
  }

  if (settings.functionCalling !== undefined && p.supportsFunctionCalling) {
    await setToggleSwitch('Function calling', settings.functionCalling);
  }

  if (
    settings.autoFunctionResponse !== undefined &&
    p.supportsAutoFunctionResponse
  ) {
    await setToggleSwitch(
      'Automatic function response',
      settings.autoFunctionResponse,
    );
  }

  if (settings.urlContext !== undefined && p.supportsUrlContext) {
    await setToggleSwitch('URL context', settings.urlContext);
  }

  if (settings.outputLength !== undefined && p.outputLength) {
    const clamped = Math.min(
      p.outputLength.max,
      Math.max(p.outputLength.min, settings.outputLength),
    );
    await setNumericInput('Output length', clamped);
  }

  if (settings.topP !== undefined && p.topP) {
    const clamped = Math.min(p.topP.max, Math.max(p.topP.min, settings.topP));
    await setNumericInput('Top P', clamped);
  }

  if (settings.videoDurationSec !== undefined && p.videoDurationSec) {
    const clamped = Math.min(
      p.videoDurationSec.max,
      Math.max(p.videoDurationSec.min, settings.videoDurationSec),
    );
    await setNumericInput('Video duration', clamped);
  }

  if (settings.videoTask && p.videoTasks?.includes(settings.videoTask)) {
    await selectDropdownValue('Video task', settings.videoTask);
  }

  if (settings.liveVoice && p.voices?.includes(settings.liveVoice)) {
    await selectDropdownValue('Voice', settings.liveVoice);
  }

  if (settings.maxContextSize !== undefined && p.contextSize) {
    await setNumericInput('Max context size', settings.maxContextSize);
  }

  if (settings.targetContextSize !== undefined && p.contextSize) {
    await setNumericInput('Target context size', settings.targetContextSize);
  }

  if (settings.stopSequences?.length && p.supportsStopSequence) {
    const stopInput = page
      .locator(
        'input[placeholder*="stop" i], input[aria-label*="stop sequence" i]',
      )
      .first();
    if ((await stopInput.count()) > 0 && (await stopInput.isVisible())) {
      for (const seq of settings.stopSequences) {
        if (seq.trim()) {
          await stopInput.fill(seq.trim()).catch(() => undefined);
          await stopInput.press('Enter').catch(() => undefined);
        }
      }
    }
  }
}

export async function attachFilesToPage(
  page: Page,
  attachments: TempAttachment[],
): Promise<void> {
  if (attachments.length === 0) return;

  const tempPaths: string[] = [];
  try {
    for (let i = 0; i < attachments.length; i++) {
      const att = attachments[i]!;
      const filePath = join(
        tmpdir(),
        `forge_web_${Date.now()}_${i}_${att.fileName}`,
      );
      writeFileSync(filePath, att.buffer);
      tempPaths.push(filePath);
    }

    const fileInput = page.locator('input[type="file"]').first();
    if ((await fileInput.count()) > 0) {
      await fileInput.setInputFiles(tempPaths);
      await page.waitForTimeout(1000);
    }
  } finally {
    for (const tp of tempPaths) {
      try {
        unlinkSync(tp);
      } catch {
        // Ignore cleanup error
      }
    }
  }
}

export async function submitPromptInPage(
  page: Page,
  platform: 'gemini' | 'aistudio',
  promptText: string,
): Promise<void> {
  if (platform === 'gemini') {
    const inputLoc = page
      .locator(
        'rich-textarea div[contenteditable="true"], div[contenteditable="true"][role="textbox"], textarea',
      )
      .first();
    await inputLoc.waitFor({ state: 'visible', timeout: 25000 });
    await inputLoc.click();
    await inputLoc.fill(promptText);
    await page.waitForTimeout(250);

    const sendBtn = page
      .locator(
        'button[aria-label*="Send message" i], button.send-button, button[aria-label*="Submit" i]',
      )
      .first();
    if ((await sendBtn.count()) > 0 && (await sendBtn.isVisible())) {
      await sendBtn.click({ timeout: 5000 });
    } else {
      await inputLoc.press('Enter');
    }
  } else {
    const inputLoc = page
      .locator(
        'ms-autosize-textarea textarea, textarea[aria-label*="Type something" i], textarea[placeholder*="Type" i], div[contenteditable="true"]',
      )
      .first();
    await inputLoc.waitFor({ state: 'visible', timeout: 25000 });
    await inputLoc.click();
    await inputLoc.fill(promptText);
    await page.waitForTimeout(250);

    const runBtn = page
      .locator(
        'button[aria-label*="Run" i], button:has-text("Run"), button[type="submit"]',
      )
      .first();
    if ((await runBtn.count()) > 0 && (await runBtn.isVisible())) {
      await runBtn.click({ timeout: 5000 });
    } else {
      await inputLoc.press('Control+Enter');
    }
  }
}
