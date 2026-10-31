# Architecture & Implementation Decisions (`DECISIONS.md`)

This document records implementation choices made where minor low-level details were left open by the master blueprint.

## Phase 1

1. **`SecretCipherService` Master Key Resolution**:
   - Constructed with an explicit base64/Buffer key parameter or falls back to `process.env.FORGE_MASTER_KEY`. When running `prisma:reset` / `seed.ts` in local development if `FORGE_MASTER_KEY` is not yet populated in `.env`, `seed-context.ts` derives a deterministic 32-byte development fallback key (`sha256('forgestudio-dev-seed-master-key-20261022')`) so `npm run prisma:reset -w @forge/backend` succeeds out of the box while still exercising real AES-256-GCM `v1:<iv>:<tag>:<cipher>` encryption.
2. **Sharp Procedural SVG Rendering**:
   - All procedural icons, style boards, concept art, seamless tiles, and spritesheets in `backend/src/synth/svg-icon.synth.ts` and `svg-art.synth.ts` generate deterministic SVG markup using `mulberry32` and rasterize to PNG/WebP via `sharp(Buffer.from(svg))`.
3. **GLB Binary Mesh Synthesizer (`glb-mesh.synth.ts`)**:
   - Writes standard glTF 2.0 binary (`.glb`, magic `0x46546C67`, version `2`) with 4-byte aligned JSON chunk (`0x4E4F534A`, space-padded `0x20`) and BIN chunk (`0x004E4942`, zero-padded `0x00`), computing smooth/averaged per-vertex normals and exact `min`/`max` bounds on the `POSITION` accessor.
4. **Zod `ModalityParamsSchema` Refinement Re-application**:
   - Per §2.5, `ModalityParamsSchema` uses `Assets3DParamsSchema.innerType()` inside `z.discriminatedUnion('modality', ...)`. We also export a helper `parseModalityParams(input)` in `@forge/shared` that runs `ModalityParamsSchema` and re-applies `Assets3DParamsSchema` refinement when `modality === 'ASSETS_3D'`.
5. **Root & Workspace `.env` Resolution for Prisma CLI**:
   - Prisma 6 resolves `.env` relative to the current working directory when invoked with `--schema backend/prisma/schema.prisma` from the monorepo root, and relative to `backend/` when invoked via `-w @forge/backend`. Providing `.env` (git-ignored) at both `./.env` and `./backend/.env` ensures both root-level `npx prisma validate --schema backend/prisma/schema.prisma` and workspace-level `npm run prisma:reset -w @forge/backend` work seamlessly.
6. **Generated Asset File Variants (`158` files across `45` assets)**:
   - Every image asset produces `ORIGINAL` (PNG), `PREVIEW` (512px WebP), and `THUMBNAIL` (256px WebP), plus format-specific exports (`EXPORT_WEB` WebP / `EXPORT_ROBLOX` 512px PNG for icons and spritesheets; `METADATA_JSON` atlas metadata for spritesheets). Every 3D asset produces `ORIGINAL` (`.glb`), `PREVIEW`, `THUMBNAIL`, and `EXPORT_GLB`. Audio/Voice assets produce `ORIGINAL` (`.wav`), `PREVIEW` (waveform PNG), and `THUMBNAIL` (256px WebP), with Voice assets also writing `ALIGNMENT_JSON`. Text/Lore assets produce `ORIGINAL` (`.md`/`.json`/`.luau`), `PREVIEW`, `THUMBNAIL`, and format-specific `EXPORT_ROBLOX` / `METADATA_JSON` where applicable, totaling 158 `GeneratedAssetFile` rows (exceeding the §6.8 minimum of 120).

## Phase 2

1. **`GENERATOR_ADAPTER_REGISTRY_PORT` & Fallback `AdapterDescriptor`**:
   - Per the Phase 2 scope, `GET /api/v1/providers/:id/adapters` queries an optional injectable `GENERATOR_ADAPTER_REGISTRY_PORT` token and returns `[]` until Phase 3 registers generator adapters. For `MiddlemanCompilerService.preview()` and `compileForJob()`, `ProvidersService.describeAdapterOrFallback()` falls back to `buildFallbackAdapterDescriptor(kind, modality, subMode)` when no generator adapter is registered yet, providing modality-specific `ParamSpec` definitions so `compile-preview` and system prompt compilation work out of the box in Phase 2.
2. **`JOB_EVENTS_PUBLISHER` Port & `LoggingJobEventsPublisher`**:
   - Defined `JOB_EVENTS_PUBLISHER` and `JobEventsPublisherPort` in `backend/src/orchestrator/job-events.port.ts` and bound `LoggingJobEventsPublisher` in `ProjectsVaultModule`, `ProvidersModule`, and `MiddlemanModule` so all Vault, Provider Health, and Middleman events are emitted through the port now and seamlessly routed to Socket.IO in Phase 3.
3. **Gemini Interactions API (`@google/genai` >= 2.29.1)**:
   - `GeminiLlmAdapter` uses `ai.interactions.create({ model, system_instruction, input, generation_config, response_format, stream: true, store: false })` per the upstream `@google/genai` Interactions API SDK docs, consuming `step.delta` / `content.delta` text events and `interaction.completed` / `interaction.complete` token usage metrics, and guarding against legacy `gemini-2.x` model IDs.
4. **Media Streaming for Seeded Cover & Voice Sample Keys**:
   - `MediaStreamController` serves `/api/v1/media/vault/:fileId`, `/api/v1/media/vault/:fileId/thumbnail`, `/api/v1/media/assets/:assetFileId`, `/api/v1/media/references/:projectId/:uploadId/:name`, plus `/api/v1/media/projects/:projectId/cover` and `/api/v1/media/voices/:voiceId/sample` with full RFC 7233 `Range` (`206 Partial Content` / `416 Range Not Satisfiable`), `ETag`, and `?download=1` support.

## Phase 4

1. **Dart Sass `@use 'styles' as *` Zero-CSS Resolution**:
   - Because Angular's global stylesheet entry point is `src/styles.scss` and the design-token hub is `src/styles/_index.scss`, Angular's Sass resolver checks file extensions before directory index files. Adding `src/styles/_styles.scss` (`@forward 'index';`) and setting `"includePaths": ["src/styles", "src"]` in `frontend/angular.json` ensures `@use 'styles' as *;` in every component stylesheet resolves to the zero-CSS token/function/mixin forwarder rather than re-emitting `src/styles.scss`.
2. **Voices Default Parameter Transcript Fallback in Phase 4 Composer**:
   - In Phase 4 (before Phase 5's modality-specific `VoicesParamsComponent` mounts), `GeneratorWorkspaceComponent` normalizes `VOICES` job submissions by populating `params.transcript` from `rawPrompt` when `params.transcript` is empty so `CreateJobSchema.superRefine` succeeds when testing `/generate/voices` with default parameters.

## Phase 5

1. **Music Loop Seam Inspector RMS Jump Calculation**:
   - `DualWaveformPlayerComponent` constructs an in-memory 4-second `AudioBuffer` joining the final 2 seconds (`min(2, duration / 2)`) and initial 2 seconds of the decoded track, computes waveform peaks for visual boundary inspection, and calculates the RMS jump in dB across a 50 ms window immediately before and after the loop boundary (`|20 * log10((rmsAfter + 1e-5) / (rmsBefore + 1e-5))|`), color-coding the badge (`emerald` `< 3 dB`, `amber` `< 6 dB`, `coral` `>= 6 dB`).
2. **Unified `ModelViewportComponent` Inputs for Stage & Vault Compact Mode**:
   - `ModelViewportComponent` accepts either `[asset]="AssetModel"` (in the 3D Assets generator stage) or `[src]="url"` + `[fileName]="name"` + `[compact]="true"` (in the Project Vault IDE `MediaPreviewComponent`), sharing `ModelViewportEngine` with `IntersectionObserver` visibility pausing and full WebGL resource disposal on destroy.

## Phase 6 (Video, Lore & MCP Server Expansion)

1. **`VIDEO` Generation & 32GB DDR5 System RAM Fallback (`RAM_FALLBACK_32GB`)**:
   - Added `Modality.VIDEO` supporting `TEXT_TO_VIDEO` and `IMAGE_TO_VIDEO` with configurable `memoryStrategy` (`RAM_FALLBACK_32GB` default). For local ComfyUI/RunPod workflows, `RAM_FALLBACK_32GB` injects CPU model offload, pinned 24GB DDR5 host RAM allocation (`maxSharedHostRamGb: 24`), and tiled VAE decoding so video diffusion continues smoothly when GPU VRAM fills.
   - `video.synth.ts` synthesizes a high-res WebP primary visual, a PNG poster thumbnail, and 8 trajectory-animated keyframe PNGs (`AssetFileRole.FRAME`) so `VideoPreviewerComponent` supports both native `<video>` playback (`.mp4`/`.webm`) and interactive frame-accurate deck playback with still-frame PNG capture.
2. **`LORE` Narrative Generation (`SHORT_FORM`, `MEDIUM_FORM`, `LONG_FORM`)**:
   - Added `Modality.LORE` covering 9 narrative categories from concise item tooltip descriptions (`SHORT_FORM`, 30–150 words) to multi-era character backstories and faction chronicles (`LONG_FORM`, 700–3,000 words), with one-click promotion from `LorePreviewerComponent` into the Project Vault (`scopes: ['LORE', 'ALWAYS_INCLUDE']`).
3. **Model Context Protocol (MCP) Server & 22 AI Tools (`/api/v1/mcp` + `npm run mcp:stdio` + `/mcp` UI)**:
   - Implemented a full JSON-RPC 2.0 MCP server (`POST /api/v1/mcp`, `GET /api/v1/mcp/sse`, and stdio transport `backend/src/mcp/mcp-stdio.ts`) exposing 22 tools across all 9 asset generators, Project Vault, Middleman compiler, and Asset Library. Generator tools default to `waitForCompletion: true` and return inline base64 `image` blocks or Markdown text plus direct download URLs and optional `exportToPath` disk writes so AI coding assistants (such as Antigravity) can generate and immediately use assets in a single tool call.




