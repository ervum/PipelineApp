# ForgeStudio Control Room — Master Blueprint · Part 1 of 5
## §0 Global Conventions · §1 Monorepo File Tree · §2 Database Schema & Shared Contracts

> [!IMPORTANT]
> This document is **normative**. Gemini Argon 4.0 MUST treat every file path, type name, enum value, endpoint and event name as an exact contract. Where a vendor API detail is quoted, the adapter file is the *only* place that detail may live (vendor isolation rule, §4.6).

---

## §0 Global Conventions (apply to every phase)

### 0.1 Pinned toolchain

| Concern | Choice | Version pin | Notes |
|---|---|---|---|
| Runtime | Node.js | `22.x LTS` | `"engines": { "node": ">=22.11" }` in every `package.json` |
| Package manager | npm workspaces | `npm >= 10.9` | Root `workspaces: ["shared","backend","frontend"]` |
| Language | TypeScript | `~5.9.x` | `strict: true`, `noUncheckedIndexedAccess: true`, `noImplicitOverride: true` |
| Backend | NestJS | `^11.x` | `@nestjs/platform-express`, `@nestjs/websockets`, `@nestjs/platform-socket.io`, `@nestjs/config`, `@nestjs/schedule` |
| ORM | Prisma | `^6.16.x` (**do not use 7.x**) | Classic `prisma-client-js` generator; `url = env("DATABASE_URL")` lives in schema |
| DB | PostgreSQL | `16` (docker) | `docker-compose.yml` at repo root |
| Validation | zod | `^3.25.x` | Shared schemas = single source of truth for DTOs (frontend + backend) |
| Realtime | socket.io / socket.io-client | `^4.8.x` | Namespace `/orchestrator` |
| Image processing | sharp | `^0.34.x` | Thumbnails, icon size variants, chroma-key alpha, spritesheet slicing |
| S3 parity | `@aws-sdk/client-s3` | `^3.x` | Only loaded when `STORAGE_DRIVER=s3` |
| Gemini | `@google/genai` | `>= 2.29.1` | **Interactions API** (`client.interactions.create`) — never `generateContent`, never `@google/generative-ai` |
| Frontend | Angular | `^20.3` or newer | Standalone, zoneless (`provideZonelessChangeDetection()`), signals, `@if/@for` control flow |
| 3D | three / @types/three | `^0.180.x` | `three/addons/*` loaders + `OrbitControls` |
| Markdown | marked + dompurify | `^16` / `^3` | Parsing/sanitising only — **not** UI libraries |
| Fonts | `@fontsource-variable/inter`, `@fontsource-variable/jetbrains-mono` | latest | Self-hosted fonts |
| Testing | Jest (backend + shared) | `^30` | `ts-jest`; frontend verified by `ng build` + `ng test` (default builder of the installed Angular version) |

**Forbidden dependencies (CI-enforced by `scripts/check-forbidden-deps.mjs`):** `tailwindcss`, `bootstrap`, `@angular/material`, `@angular/cdk`, `primeng`, `@ng-bootstrap/*`, `ngx-*` UI kits, `bullmq`, `redis`, `@google/generative-ai`.

### 0.2 Code conventions
- File names: `kebab-case`. Angular: `name.component.ts|html|scss` (keep the `.component` suffix explicitly — do **not** use v20 suffix-less defaults). Services `*.service.ts`, signal stores `*.store.ts` or `*-state.service.ts`, NestJS adapters `*.adapter.ts`.
- IDs: `cuid()` strings. Timestamps on the wire: ISO‑8601 strings. Money: `number` (USD, 6 dp) on the wire, `Decimal(12,6)` in DB.
- Seeds: integer `0..2147483647` (`SEED_MAX` in shared) so they fit Postgres `Int`.
- REST prefix: `/api/v1`. WebSocket namespace: `/orchestrator`. Backend port `3000`, frontend `4200` with `proxy.conf.json` forwarding `/api` and `/socket.io` (ws: true).
- Error envelope (every non-2xx): `{ "statusCode": number, "code": ErrorCode, "message": string, "details"?: unknown, "traceId": string }`.
- **No `// TODO`, no placeholder functions, no `any`** (use `unknown` + zod narrowing). ESLint rule `@typescript-eslint/no-explicit-any: error`.
- Event-name normalisation: the request mentioned `job:Middleman-complete`; the canonical name is **`job:middleman-complete`** (all lowercase, kebab).

### 0.3 Environment variables (`/backend/.env.example`)
```dotenv
NODE_ENV=development
PORT=3000
DATABASE_URL=postgresql://forge:forge@localhost:5432/forgestudio?schema=public
FORGE_MASTER_KEY=            # base64 of 32 random bytes; `npm run keygen -w backend` prints one
STORAGE_DRIVER=local         # local | s3
STORAGE_ROOT=./storage       # resolved relative to /backend
S3_ENDPOINT=http://localhost:9000
S3_REGION=us-east-1
S3_BUCKET=forgestudio
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
S3_FORCE_PATH_STYLE=true
PUBLIC_WEBHOOK_BASE_URL=     # optional, e.g. https://my-tunnel.example.com — enables RunPod webhooks
WEBHOOK_SIGNING_SECRET=      # random string; HMAC for webhook tokens
CORS_ORIGIN=http://localhost:4200
JOB_WORKER_TICK_MS=1000
JOB_MAX_CONCURRENT_GLOBAL=6
MAX_UPLOAD_MB=200
```

---

## §1 Monorepo File Tree

> Every file listed MUST exist at the end of the phase that owns it (owner phase in brackets). Files not listed MUST NOT be invented except Angular CLI boilerplate (`angular.json`, `tsconfig.app.json`, `tsconfig.spec.json`) which are listed for completeness.

```text
WorkflowApp/                                   (repo root)                              [P1]
├── package.json                               root workspaces + scripts                [P1]
├── package-lock.json                                                                   [P1]
├── tsconfig.base.json                         shared compiler options                  [P1]
├── .editorconfig · .gitignore · .prettierrc · .prettierignore · .nvmrc (22)            [P1]
├── eslint.config.mjs                          flat config for all workspaces           [P1]
├── docker-compose.yml                         postgres:16 + minio (profile "s3")        [P1]
├── README.md                                  setup, scripts, architecture summary     [P1]
├── scripts/
│   └── check-forbidden-deps.mjs               fails CI if forbidden deps present       [P1]
├── docs/
│   └── blueprint/                             these 5 blueprint parts, verbatim        [P1]
│
├── shared/                                    package name: @forge/shared              [P1]
│   ├── package.json                           dual exports (cjs + esm + types)
│   ├── tsconfig.json · tsconfig.cjs.json · tsconfig.esm.json · jest.config.ts
│   ├── src/
│   │   ├── index.ts                           barrel: re-exports every folder index
│   │   ├── enums/
│   │   │   ├── modality.enum.ts
│   │   │   ├── context-scope.enum.ts
│   │   │   ├── job-status.enum.ts
│   │   │   ├── execution.enum.ts              ExecutionMode, ExecutionTier
│   │   │   ├── provider.enum.ts               ProviderKind, ProviderRole, HealthState
│   │   │   ├── asset.enum.ts                  ApprovalStatus, AssetFileRole, GenerationSubMode
│   │   │   ├── vault.enum.ts                  VaultFileKind, VisionStatus
│   │   │   ├── error-code.enum.ts
│   │   │   └── index.ts
│   │   ├── schemas/                           zod schemas (+ inferred types exported)
│   │   │   ├── common.schema.ts               Id, Pagination, HexColor, Seed
│   │   │   ├── project.schema.ts
│   │   │   ├── vault.schema.ts
│   │   │   ├── provider.schema.ts             incl. RunPod template + output mapping
│   │   │   ├── middleman.schema.ts            profiles, templates, CompiledPrompt
│   │   │   ├── modality-params.schema.ts      discriminated union of 7 param shapes
│   │   │   ├── job.schema.ts
│   │   │   ├── asset.schema.ts
│   │   │   ├── voice-profile.schema.ts
│   │   │   └── index.ts
│   │   ├── models/                            read-model (view) interfaces returned by API
│   │   │   ├── project.model.ts · vault.model.ts · provider.model.ts · middleman.model.ts
│   │   │   ├── job.model.ts · asset.model.ts · voice-profile.model.ts · param-spec.model.ts
│   │   │   └── index.ts
│   │   ├── events/
│   │   │   ├── ws-events.ts                   ServerToClient / ClientToServer maps + payloads
│   │   │   └── index.ts
│   │   ├── constants/
│   │   │   ├── modality-meta.ts               labels, icons, routes, accepted file types
│   │   │   ├── job-state-machine.ts           allowed transitions + terminal set
│   │   │   ├── limits.ts                      SEED_MAX, upload limits, token budgets
│   │   │   ├── template-variables.ts          RunPod/Comfy/Generic interpolation variables
│   │   │   └── index.ts
│   │   └── utils/
│   │       ├── mention-parser.ts              @filename extraction
│   │       ├── template-interpolation.ts      type-preserving {{var}} interpolation
│   │       ├── json-path.ts                   dot-path + [*] resolver for output mapping
│   │       ├── token-estimate.ts
│   │       ├── word-diff.ts                   LCS word diff (used by FE diff panel + tests)
│   │       └── index.ts
│   └── test/
│       ├── template-interpolation.spec.ts · json-path.spec.ts · mention-parser.spec.ts
│       ├── word-diff.spec.ts · job-state-machine.spec.ts · modality-params.spec.ts
│
├── backend/                                   package name: @forge/backend
│   ├── package.json · nest-cli.json · tsconfig.json · tsconfig.build.json · jest.config.ts
│   ├── .env.example                                                                     [P1]
│   ├── prisma/
│   │   ├── schema.prisma                                                               [P1]
│   │   ├── migrations/                        generated by `prisma migrate dev --name init` [P1]
│   │   ├── seed.ts                            orchestrates seed modules                [P1]
│   │   └── seed/
│   │       ├── seed-context.ts                prisma client + storage writer helpers   [P1]
│   │       ├── providers.seed.ts                                                       [P1]
│   │       ├── middleman.seed.ts              profiles + 7 modality templates          [P1]
│   │       ├── project-astra.seed.ts          project, folders, vault docs, voices     [P1]
│   │       ├── project-anime.seed.ts                                                   [P1]
│   │       ├── assets.seed.ts                 jobs + generated assets, all 7 modalities [P1]
│   │       └── content/                       raw markdown/json strings (TS modules)   [P1]
│   │           ├── astra-art-bible.md.ts · astra-palette.md.ts · astra-icon-guide.md.ts
│   │           ├── astra-3d-standards.md.ts · astra-lore.md.ts · astra-characters.md.ts
│   │           ├── astra-music-direction.md.ts · astra-sfx-palette.md.ts · astra-naming.md.ts
│   │           ├── astra-items.json.ts
│   │           ├── anime-art-bible.md.ts · anime-rank-emblems.md.ts · anime-palette.md.ts
│   │           ├── anime-aura-vfx.md.ts · anime-luau-conventions.md.ts · anime-audio.md.ts
│   │           ├── anime-characters.md.ts · anime-gacha-table.json.ts
│   │           └── middleman-templates.ts     7 system templates (verbatim text, §6.4)
│   ├── src/
│   │   ├── main.ts                                                                     [P2]
│   │   ├── app.module.ts                                                               [P2]
│   │   ├── config/
│   │   │   ├── env.schema.ts                  zod env validation (fail-fast)           [P2]
│   │   │   ├── app-config.service.ts          typed getters                            [P2]
│   │   │   └── app-config.module.ts           @Global                                  [P2]
│   │   ├── common/
│   │   │   ├── errors/domain.error.ts         DomainError(code,status,message,details) [P2]
│   │   │   ├── filters/all-exceptions.filter.ts                                        [P2]
│   │   │   ├── pipes/zod-validation.pipe.ts                                            [P2]
│   │   │   ├── decorators/zod-body.decorator.ts  @ZodBody(schema) / @ZodQuery(schema)  [P2]
│   │   │   ├── http/http-client.service.ts    fetch wrapper: timeout, retry, typed errors [P2]
│   │   │   ├── http/sse-reader.ts             async-iterable SSE parser                [P2]
│   │   │   ├── http/ndjson-reader.ts          async-iterable NDJSON parser             [P2]
│   │   │   ├── utils/backoff.ts · sanitize-filename.ts · sha256.ts · sleep.ts · mime.ts [P2]
│   │   │   └── mappers/                       Prisma row → shared model mappers         [P2]
│   │   │       ├── project.mapper.ts · vault.mapper.ts · provider.mapper.ts
│   │   │       ├── middleman.mapper.ts · job.mapper.ts · asset.mapper.ts
│   │   ├── prisma/prisma.module.ts · prisma.service.ts                                 [P2]
│   │   ├── synth/                             procedural media (seed + Demo adapter)   [P1]
│   │   │   ├── rng.ts                         mulberry32 seeded PRNG
│   │   │   ├── svg-icon.synth.ts              procedural SVG icon → PNG via sharp
│   │   │   ├── svg-art.synth.ts               gradient/starfield art, tiles, spritesheets
│   │   │   ├── glb-mesh.synth.ts              minimal glTF 2.0 binary writer (+ shapes)
│   │   │   ├── wav-audio.synth.ts             PCM16 WAV writer + music/sfx/voice synths
│   │   │   └── text.synth.ts                  shader/lore JSON templating
│   │   ├── storage/                                                                    [P2]
│   │   │   ├── storage.module.ts · storage.service.ts · storage-keys.ts
│   │   │   ├── storage-driver.interface.ts
│   │   │   ├── drivers/local-storage.driver.ts · drivers/s3-storage.driver.ts
│   │   │   ├── image-processing.service.ts    sharp: thumbs, variants, chroma-key, slicing
│   │   │   └── media-stream.controller.ts     Range (206) streaming endpoints
│   │   ├── projects-vault/                                                             [P2]
│   │   │   ├── projects-vault.module.ts
│   │   │   ├── projects.controller.ts · projects.service.ts
│   │   │   ├── vault-folders.controller.ts · vault-folders.service.ts
│   │   │   ├── vault-files.controller.ts · vault-files.service.ts
│   │   │   ├── voice-profiles.controller.ts · voice-profiles.service.ts
│   │   │   ├── vault-context.service.ts       scoped context query for Middleman
│   │   │   └── vision-analysis.service.ts     styleDescriptorText extraction
│   │   ├── providers/                                                                  [P2]
│   │   │   ├── providers.module.ts · providers.controller.ts · providers.service.ts
│   │   │   ├── secret-cipher.service.ts       AES-256-GCM
│   │   │   ├── provider-catalog.ts            static catalog: kinds → roles/modalities/fields
│   │   │   └── provider-health.service.ts
│   │   ├── middleman/                                                                  [P2]
│   │   │   ├── middleman.module.ts
│   │   │   ├── middleman-profiles.controller.ts · middleman-profiles.service.ts
│   │   │   ├── middleman-templates.controller.ts · middleman-templates.service.ts
│   │   │   ├── middleman-compiler.service.ts
│   │   │   ├── context-assembler.service.ts   budgeting + ordering of vault context
│   │   │   ├── system-prompt.builder.ts
│   │   │   ├── compiled-output.parser.ts      extraction, zod validation, repair, clamping
│   │   │   └── llm/
│   │   │       ├── llm.module.ts              LlmModule (imported by Vault + Middleman; breaks cycle)
│   │   │       ├── llm-adapter.interface.ts · llm-adapter.registry.ts
│   │   │       ├── anthropic.llm-adapter.ts · openai.llm-adapter.ts · gemini.llm-adapter.ts
│   │   │       ├── ollama.llm-adapter.ts · openai-compatible.llm-adapter.ts
│   │   │       └── demo.llm-adapter.ts        deterministic offline compiler
│   │   ├── generators/                                                                 [P3]
│   │   │   ├── generators.module.ts
│   │   │   ├── generator-adapter.interface.ts · generator-adapter.registry.ts
│   │   │   ├── base/base-generator.adapter.ts · base/param-spec.helpers.ts
│   │   │   ├── adapters/cloud/
│   │   │   │   ├── openai-image.adapter.ts · openai-tts.adapter.ts · gemini-image.adapter.ts
│   │   │   │   ├── gemini-tts.adapter.ts · fal-image.adapter.ts · replicate.adapter.ts
│   │   │   │   ├── stability-image.adapter.ts · stability-audio.adapter.ts
│   │   │   │   ├── meshy.adapter.ts · tripo3d.adapter.ts · rodin.adapter.ts
│   │   │   │   ├── elevenlabs-tts.adapter.ts · elevenlabs-sfx.adapter.ts · elevenlabs-music.adapter.ts
│   │   │   │   ├── cartesia-tts.adapter.ts · fish-audio-tts.adapter.ts
│   │   │   │   └── llm-text.adapter.ts        SHADER_CODE / LORE_JSON via any LLM profile
│   │   │   ├── adapters/runpod/runpod-client.ts · runpod-serverless.adapter.ts
│   │   │   ├── adapters/local/comfyui.adapter.ts · comfyui-ws.client.ts · a1111.adapter.ts
│   │   │   ├── adapters/local/openai-compatible-tts.adapter.ts · generic-http.adapter.ts
│   │   │   ├── adapters/demo/demo-synth.adapter.ts
│   │   │   ├── jobs.controller.ts · jobs.service.ts
│   │   │   ├── job-processor.service.ts       claim loop, compile, dispatch, poll, recover
│   │   │   ├── job-state.service.ts           guarded transitions + event log + emit
│   │   │   ├── output-ingestion.service.ts    outputs → storage → GeneratedAsset(+Files)
│   │   │   ├── post-processors/icon.post.ts · spritesheet.post.ts · audio.post.ts · model3d.post.ts
│   │   │   ├── cost-estimator.service.ts
│   │   │   └── webhooks.controller.ts         RunPod webhook receiver
│   │   ├── assets/                                                                     [P3]
│   │   │   ├── assets.module.ts · assets.controller.ts · assets.service.ts
│   │   ├── orchestrator/                                                               [P3]
│   │   │   ├── orchestrator.module.ts · orchestrator.gateway.ts · job-events.publisher.ts
│   │   └── health/health.controller.ts                                                 [P2]
│   └── test/                                                                           [P2/P3]
│       ├── secret-cipher.spec.ts · compiled-output.parser.spec.ts · context-assembler.spec.ts
│       ├── system-prompt.builder.spec.ts · runpod-serverless.adapter.spec.ts
│       ├── job-state.service.spec.ts · glb-mesh.synth.spec.ts · wav-audio.synth.spec.ts
│       └── e2e/jobs.e2e-spec.ts               Demo LLM + Demo Synth full pipeline
│
└── frontend/                                  package name: @forge/frontend            [P4/P5]
    ├── package.json · angular.json · tsconfig.json · tsconfig.app.json · tsconfig.spec.json
    ├── proxy.conf.json
    └── src/
        ├── index.html · main.ts · styles.scss
        ├── environments/environment.ts · environment.development.ts
        ├── assets/icons/sprite.svg            hand-authored SVG symbol sprite (§3.9)
        ├── styles/                                                                     [P4]
        │   ├── _index.scss                    @forward hub
        │   ├── _tokens.scss · _functions.scss · _mixins.scss · _reset.scss
        │   ├── _typography.scss · _grid.scss · _animations.scss · _root-vars.scss
        │   └── base/ _buttons.scss · _forms.scss · _badges.scss · _pills.scss · _tabs.scss
        │            _cards.scss · _drawers.scss · _modals.scss · _tables.scss · _tooltips.scss
        │            _progress.scss · _code.scss · _markdown.scss
        └── app/
            ├── app.config.ts · app.routes.ts · app.component.ts|html|scss              [P4]
            ├── core/                                                                   [P4]
            │   ├── api/ api-client.service.ts · projects.api.ts · vault.api.ts · providers.api.ts
            │   │        middleman.api.ts · jobs.api.ts · assets.api.ts · voice-profiles.api.ts
            │   ├── realtime/socket.service.ts
            │   ├── state/ studio-state.service.ts · vault-state.service.ts · generator-job.store.ts
            │   │          provider-state.service.ts · asset-gallery.store.ts · toast.service.ts
            │   ├── interceptors/api-error.interceptor.ts
            │   ├── guards/active-project.guard.ts
            │   └── utils/ format.ts · file-kind.ts · download.ts · keyboard.ts
            ├── ui/                            in-house primitives (no UI libraries)    [P4]
            │   ├── button/ · icon/ · select/ · slider/ · toggle/ · segmented-control/ · tabs/
            │   ├── drawer/ · modal/ · tooltip/ (directive) · progress-bar/ · status-pill/
            │   ├── tier-badge/ · dropzone/ · empty-state/ · toast-host/ · context-menu/
            │   ├── split-pane/ · confirm-dialog/ · chip-input/ · json-editor/ · code-view/
            │   └── (each: x.component.ts|html|scss; directives: x.directive.ts)
            ├── layout/                                                                 [P4]
            │   ├── studio-shell/ · sidebar/ · project-switcher/ · nav-group/
            │   ├── job-queue-widget/ · context-bar/
            ├── features/
            │   ├── vault/                                                              [P4]
            │   │   ├── vault-page/ · folder-tree/ · file-browser/ · file-editor/
            │   │   ├── markdown-preview/ · media-preview/ · scope-tag-editor/
            │   │   ├── vision-panel/ · upload-queue/ · project-form-modal/ · voice-profiles-panel/
            │   ├── providers/                                                          [P4]
            │   │   ├── providers-page/ · provider-list/ · provider-editor/
            │   │   ├── runpod-template-editor/ · middleman-profiles-panel/
            │   │   ├── middleman-templates-panel/ · health-indicator/
            │   └── generators/                                                         [P5]
            │       ├── workspace/generator-workspace.component.*
            │       ├── composer/ generation-composer/ · prompt-input/ · vault-pin-picker/
            │       │            provider-selector/ · middleman-selector/ · execution-mode-toggle/
            │       │            advanced-params/ · reference-slot/
            │       ├── middleman/ middleman-status-pill/ · compile-review-drawer/ · prompt-diff/
            │       │              context-sources-list/
            │       ├── params/ icons-params/ · assets3d-params/ · images-params/ · music-params/
            │       │           voices-params/ · sfx-params/ · other-params/
            │       ├── previews/ icon-previewer/ · model-viewport/ · image-previewer/
            │       │             waveform-player/ · dual-waveform-player/ · voice-alignment-view/
            │       │             sfx-variation-grid/ · spritesheet-player/ · code-preview/ · json-tree-view/
            │       ├── history/ asset-history-drawer/ · asset-card/ · asset-inspector/ · history-filters/
            │       └── engines/ model-viewport.engine.ts · lighting-rigs.ts · audio-engine.service.ts
            │                    waveform-peaks.ts · waveform-peaks.worker.ts · waveform-renderer.ts
```

### 1.1 Root `package.json` (exact)
```json
{
  "name": "forgestudio-control-room",
  "private": true,
  "engines": { "node": ">=22.11" },
  "workspaces": ["shared", "backend", "frontend"],
  "scripts": {
    "db:up": "docker compose up -d postgres",
    "build:shared": "npm run build -w @forge/shared",
    "dev": "npm run build:shared && concurrently -k -n shared,api,web -c cyan,magenta,green \"npm run watch -w @forge/shared\" \"npm run start:dev -w @forge/backend\" \"npm run start -w @forge/frontend\"",
    "build": "npm run build:shared && npm run build -w @forge/backend && npm run build -w @forge/frontend",
    "test": "npm run test -w @forge/shared && npm run test -w @forge/backend",
    "lint": "eslint . && node scripts/check-forbidden-deps.mjs",
    "db:reset": "npm run prisma:reset -w @forge/backend"
  },
  "devDependencies": { "concurrently": "^9.2.0", "eslint": "^9", "typescript-eslint": "^8", "prettier": "^3" }
}
```

### 1.2 `/shared/package.json` dual build
```json
{
  "name": "@forge/shared",
  "version": "1.0.0",
  "private": true,
  "main": "./dist/cjs/index.js",
  "module": "./dist/esm/index.js",
  "types": "./dist/types/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/types/index.d.ts",
      "import": "./dist/esm/index.js",
      "require": "./dist/cjs/index.js"
    }
  },
  "sideEffects": false,
  "scripts": {
    "build": "rimraf dist && tsc -p tsconfig.esm.json && tsc -p tsconfig.cjs.json && node -e \"require('fs').writeFileSync('dist/cjs/package.json','{\\\"type\\\":\\\"commonjs\\\"}');require('fs').writeFileSync('dist/esm/package.json','{\\\"type\\\":\\\"module\\\"}')\"",
    "watch": "tsc -p tsconfig.esm.json --watch --preserveWatchOutput",
    "test": "jest"
  },
  "dependencies": { "zod": "^3.25.0" },
  "devDependencies": { "rimraf": "^6", "jest": "^30", "ts-jest": "^29", "@types/jest": "^30" }
}
```
`tsconfig.esm.json`: `module: "ES2022"`, `moduleResolution: "Bundler"`, `outDir: dist/esm`, `declaration: true`, `declarationDir: dist/types`. `tsconfig.cjs.json`: `module: "CommonJS"`, `moduleResolution: "Node10"`, `outDir: dist/cjs`, `declaration: false`. Shared source uses **extensionless relative imports**, no Node built-ins, no DOM types (must run in both runtimes).

### 1.3 `docker-compose.yml`
```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment: { POSTGRES_USER: forge, POSTGRES_PASSWORD: forge, POSTGRES_DB: forgestudio }
    ports: ["5432:5432"]
    volumes: [pgdata:/var/lib/postgresql/data]
    healthcheck: { test: ["CMD-SHELL", "pg_isready -U forge"], interval: 5s, retries: 10 }
  minio:
    profiles: ["s3"]
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    environment: { MINIO_ROOT_USER: forge, MINIO_ROOT_PASSWORD: forgeforge }
    ports: ["9000:9000", "9001:9001"]
    volumes: [miniodata:/data]
volumes: { pgdata: {}, miniodata: {} }
```

---

## §2 Database Schema & Shared Contracts

### 2.1 Entity relationship overview

```mermaid
erDiagram
  Project ||--o{ VaultFolder : contains
  Project ||--o{ VaultFile : owns
  VaultFolder ||--o{ VaultFolder : nests
  VaultFolder ||--o{ VaultFile : holds
  Project ||--o{ VoiceProfile : casts
  VoiceProfile }o--o| VaultFile : "character sheet"
  Project ||--o{ GenerationJob : runs
  GenerationJob ||--o{ GenerationJobEvent : logs
  GenerationJob ||--o{ GeneratedAsset : produces
  GeneratedAsset ||--o{ GeneratedAssetFile : stores
  GeneratedAsset |o--o| VaultFile : "saved as reference"
  AiProviderConfig ||--o{ MiddlemanProfile : powers
  AiProviderConfig ||--o{ GenerationJob : executes
  MiddlemanProfile ||--o{ GenerationJob : compiles
  MiddlemanTemplate ||--o{ GenerationJob : "system blueprint"
  Project ||--o{ MiddlemanTemplate : "optional override"
```

### 2.2 `backend/prisma/schema.prisma` (complete, exact)

```prisma
// ForgeStudio Control Room — Prisma schema (Prisma 6.x, PostgreSQL 16)

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ───────────────────────────── Enums ─────────────────────────────

enum Modality {
  ICONS_2D
  ASSETS_3D
  IMAGES
  MUSIC
  VOICES
  SFX
  OTHER
}

/// DB values match the product vocabulary ("2D_ICONS"); client identifiers must be valid TS identifiers.
enum ContextScope {
  ALWAYS_INCLUDE
  ICONS_2D  @map("2D_ICONS")
  ASSETS_3D @map("3D_ASSETS")
  IMAGES
  MUSIC
  VOICES
  SFX
  OTHER
}

enum VaultFileKind {
  MARKDOWN
  TEXT
  JSON
  IMAGE
  AUDIO
  MODEL_3D
  OTHER
}

enum VisionStatus {
  NONE
  PENDING
  RUNNING
  DONE
  FAILED
}

enum ExecutionTier {
  CLOUD_API
  RUNPOD
  LOCAL
}

enum ProviderRole {
  LLM
  VISION
  GENERATOR
}

enum ProviderKind {
  ANTHROPIC
  OPENAI
  GEMINI
  FAL
  REPLICATE
  STABILITY
  MESHY
  TRIPO3D
  RODIN
  ELEVENLABS
  CARTESIA
  FISH_AUDIO
  RUNPOD_SERVERLESS
  COMFYUI
  A1111
  OLLAMA
  OPENAI_COMPATIBLE
  GENERIC_HTTP
  DEMO
}

enum HealthState {
  UNKNOWN
  HEALTHY
  DEGRADED
  UNREACHABLE
  UNAUTHORIZED
}

enum ExecutionMode {
  AUTO_FIRE
  INTERCEPT
}

enum JobStatus {
  QUEUED
  COMPILING
  AWAITING_REVIEW
  READY
  DISPATCHING
  COLD_START
  RUNNING
  INGESTING
  COMPLETED
  FAILED
  CANCELLED
}

enum GenerationSubMode {
  STANDARD
  TEXT_TO_3D
  IMAGE_TO_3D
  SPRITESHEET
  VFX_TEXTURE
  SHADER_CODE
  LORE_JSON
}

enum ApprovalStatus {
  DRAFT
  APPROVED
  REJECTED
  FINAL
}

enum AssetFileRole {
  PRIMARY
  THUMBNAIL
  PREVIEW
  VARIANT_512
  VARIANT_128
  VARIANT_64
  VARIANT_32
  TEXTURE_BASE_COLOR
  TEXTURE_NORMAL
  TEXTURE_ORM
  STEM
  FRAME
  ALIGNMENT
  METADATA
  SOURCE_REFERENCE
}

// ───────────────────────────── Projects & Vault ─────────────────────────────

model Project {
  id             String   @id @default(cuid())
  slug           String   @unique
  name           String
  tagline        String   @default("")
  description    String   @default("") @db.Text
  genre          String   @default("")
  accentHex      String   @default("#7C3AED")
  coverStorageKey String?
  /// Short always-on project summary; injected first by the Middleman.
  globalSummary  String   @default("") @db.Text
  archivedAt     DateTime?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  folders            VaultFolder[]
  files              VaultFile[]
  voiceProfiles      VoiceProfile[]
  jobs               GenerationJob[]
  assets             GeneratedAsset[]
  middlemanTemplates MiddlemanTemplate[]

  @@map("projects")
}

model VaultFolder {
  id        String   @id @default(cuid())
  projectId String
  parentId  String?
  name      String
  /// Materialised path, "/" for root, "/Art Direction/Palettes" for nested. Recomputed on rename/move.
  path      String
  sortOrder Int      @default(0)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  project  Project       @relation(fields: [projectId], references: [id], onDelete: Cascade)
  parent   VaultFolder?  @relation("FolderTree", fields: [parentId], references: [id], onDelete: Cascade)
  children VaultFolder[] @relation("FolderTree")
  files    VaultFile[]

  @@unique([projectId, path])
  @@index([projectId, parentId])
  @@map("vault_folders")
}

model VaultFile {
  id                  String         @id @default(cuid())
  projectId           String
  folderId            String
  name                String
  extension           String
  kind                VaultFileKind
  mimeType            String
  sizeBytes           Int            @default(0)
  checksumSha256      String?
  /// Editable text body for MARKDOWN / TEXT / JSON kinds (source of truth for those kinds).
  contentText         String?        @db.Text
  /// Binary location for IMAGE / AUDIO / MODEL_3D kinds (and a mirror copy for text uploads).
  storageKey          String?
  thumbnailKey        String?
  scopes              ContextScope[] @default([])
  /// 0–100, higher first when assembling Middleman context.
  priority            Int            @default(50)
  description         String         @default("")
  tokenEstimate       Int            @default(0)
  styleDescriptorText String?        @db.Text
  styleDescriptorJson Json?
  visionStatus        VisionStatus   @default(NONE)
  visionModel         String?
  visionError         String?
  visionAnalyzedAt    DateTime?
  width               Int?
  height              Int?
  durationMs          Int?
  metadata            Json           @default("{}")
  sourceAssetId       String?        @unique
  createdAt           DateTime       @default(now())
  updatedAt           DateTime       @updatedAt

  project       Project         @relation(fields: [projectId], references: [id], onDelete: Cascade)
  folder        VaultFolder     @relation(fields: [folderId], references: [id], onDelete: Cascade)
  sourceAsset   GeneratedAsset? @relation("AssetSavedToVault", fields: [sourceAssetId], references: [id], onDelete: SetNull)
  voiceProfiles VoiceProfile[]

  @@unique([folderId, name])
  @@index([projectId, kind])
  @@index([scopes], type: Gin)
  @@map("vault_files")
}

model VoiceProfile {
  id                    String   @id @default(cuid())
  projectId             String
  name                  String
  characterSheetFileId  String?
  providerConfigId      String?
  /// Vendor voice id (ElevenLabs voice_id, Cartesia voice id, Fish reference_id, OpenAI voice name, local speaker id).
  externalVoiceId       String   @default("")
  description           String   @default("") @db.Text
  defaultSettings       Json     @default("{}")
  sampleStorageKey      String?
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt

  project        Project           @relation(fields: [projectId], references: [id], onDelete: Cascade)
  characterSheet VaultFile?        @relation(fields: [characterSheetFileId], references: [id], onDelete: SetNull)
  providerConfig AiProviderConfig? @relation(fields: [providerConfigId], references: [id], onDelete: SetNull)

  @@unique([projectId, name])
  @@map("voice_profiles")
}

// ───────────────────────────── Providers & Middleman ─────────────────────────────

model AiProviderConfig {
  id                   String         @id @default(cuid())
  name                 String         @unique
  kind                 ProviderKind
  tier                 ExecutionTier
  roles                ProviderRole[]
  modalities           Modality[]
  baseUrl              String?
  /// "v1:<ivB64>:<tagB64>:<cipherB64>" AES-256-GCM, never returned by the API.
  encryptedSecret      String?
  secretLast4          String?
  runpodEndpointId     String?
  defaultModel         String?
  /// [{ id, label, modalities[], notes? }]
  models               Json           @default("[]")
  /// RunPod / GenericHttp JSON body template with {{variables}}.
  payloadTemplate      Json?
  /// { assets: [{ path, encoding: "base64"|"url"|"text", mimeType?, role? }], progressPath?, errorPath? }
  outputMapping        Json?
  /// ComfyUI workflow (API format) with {{variables}}.
  workflowTemplate     Json?
  extraHeaders         Json           @default("{}")
  /// { timeoutMs, pollIntervalMs, maxPollIntervalMs, maxConcurrency, costPerSecondUsd, costPerRequestUsd, executionTimeoutMs, ttlMs }
  settings             Json           @default("{}")
  defaultForModalities Modality[]     @default([])
  isEnabled            Boolean        @default(true)
  healthState          HealthState    @default(UNKNOWN)
  healthLatencyMs      Int?
  healthMessage        String?
  healthCheckedAt      DateTime?
  createdAt            DateTime       @default(now())
  updatedAt            DateTime       @updatedAt

  middlemanProfiles MiddlemanProfile[]
  jobs              GenerationJob[]
  voiceProfiles     VoiceProfile[]

  @@index([kind])
  @@map("ai_provider_configs")
}

model MiddlemanProfile {
  id                    String   @id @default(cuid())
  name                  String   @unique
  providerConfigId      String
  model                 String
  temperature           Float    @default(0.4)
  maxOutputTokens       Int      @default(1600)
  /// Budget for vault context injected into the user message.
  maxContextTokens      Int      @default(12000)
  supportsVision        Boolean  @default(false)
  attachReferenceImages Boolean  @default(false)
  maxReferenceImages    Int      @default(3)
  jsonMode              Boolean  @default(true)
  isDefault             Boolean  @default(false)
  isVisionDefault       Boolean  @default(false)
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt

  providerConfig AiProviderConfig @relation(fields: [providerConfigId], references: [id], onDelete: Cascade)
  jobs           GenerationJob[]

  @@map("middleman_profiles")
}

/// Modality System Blueprint. projectId null = global default; non-null = project override.
model MiddlemanTemplate {
  id                     String   @id @default(cuid())
  projectId              String?
  modality               Modality
  name                   String
  systemTemplate         String   @db.Text
  defaultNegativePrompt  String   @default("") @db.Text
  /// Extra hard rules appended verbatim, one per line.
  hardConstraints        String   @default("") @db.Text
  version                Int      @default(1)
  isActive               Boolean  @default(true)
  createdAt              DateTime @default(now())
  updatedAt              DateTime @updatedAt

  project Project?        @relation(fields: [projectId], references: [id], onDelete: Cascade)
  jobs    GenerationJob[]

  @@unique([projectId, modality, version])
  @@index([modality, isActive])
  @@map("middleman_templates")
}

// ───────────────────────────── Jobs & Assets ─────────────────────────────

model GenerationJob {
  id                   String            @id @default(cuid())
  projectId            String
  modality             Modality
  subMode              GenerationSubMode @default(STANDARD)
  executionMode        ExecutionMode
  status               JobStatus         @default(QUEUED)
  rawPrompt            String            @db.Text
  pinnedFileIds        String[]          @default([])
  userParams           Json
  referenceStorageKeys String[]          @default([])
  skipMiddleman        Boolean           @default(false)

  middlemanProfileId   String?
  middlemanTemplateId  String?
  middlemanRawOutput   String?           @db.Text
  /// CompiledPrompt as produced by the LLM (validated).
  compiledPayload      Json?
  /// CompiledPrompt after user edits in Intercept mode (dispatch uses this when present).
  editedPayload        Json?
  contextFileIds       String[]          @default([])
  middlemanUsage       Json?
  middlemanStartedAt   DateTime?
  middlemanCompletedAt DateTime?

  providerConfigId     String
  providerModel        String?
  tier                 ExecutionTier
  externalJobId        String?
  externalStatus       String?
  /// Adapter-specific resume handle (e.g. { statusUrl, responseUrl } for fal).
  remoteHandle         Json?
  seed                 Int?
  batchCount           Int               @default(1)
  progressPercent      Int               @default(0)
  progressStage        String?
  coldStartMs          Int?
  queueDelayMs         Int?
  executionMs          Int?
  costUsd              Decimal?          @db.Decimal(12, 6)
  pollCount            Int               @default(0)
  nextPollAt           DateTime?
  attempt              Int               @default(1)
  errorCode            String?
  errorMessage         String?           @db.Text
  parentJobId          String?

  createdAt            DateTime          @default(now())
  dispatchedAt         DateTime?
  startedAt            DateTime?
  completedAt          DateTime?
  updatedAt            DateTime          @updatedAt

  project           Project              @relation(fields: [projectId], references: [id], onDelete: Cascade)
  middlemanProfile  MiddlemanProfile?    @relation(fields: [middlemanProfileId], references: [id], onDelete: SetNull)
  middlemanTemplate MiddlemanTemplate?   @relation(fields: [middlemanTemplateId], references: [id], onDelete: SetNull)
  providerConfig    AiProviderConfig     @relation(fields: [providerConfigId], references: [id], onDelete: Restrict)
  parentJob         GenerationJob?       @relation("JobLineage", fields: [parentJobId], references: [id], onDelete: SetNull)
  childJobs         GenerationJob[]      @relation("JobLineage")
  events            GenerationJobEvent[]
  assets            GeneratedAsset[]

  @@index([status, nextPollAt])
  @@index([projectId, modality, createdAt(sort: Desc)])
  @@map("generation_jobs")
}

model GenerationJobEvent {
  id         String     @id @default(cuid())
  jobId      String
  type       String
  fromStatus JobStatus?
  toStatus   JobStatus?
  message    String     @default("")
  payload    Json       @default("{}")
  createdAt  DateTime   @default(now())

  job GenerationJob @relation(fields: [jobId], references: [id], onDelete: Cascade)

  @@index([jobId, createdAt])
  @@map("generation_job_events")
}

model GeneratedAsset {
  id               String            @id @default(cuid())
  projectId        String
  jobId            String?
  modality         Modality
  subMode          GenerationSubMode @default(STANDARD)
  title            String
  /// Lineage group: all versions/variations of the same asset share it.
  assetGroupId     String
  version          Int               @default(1)
  batchIndex       Int               @default(0)
  parentAssetId    String?
  rawPrompt        String            @db.Text
  enhancedPrompt   String            @db.Text
  negativePrompt   String            @default("") @db.Text
  approval         ApprovalStatus    @default(DRAFT)
  isFavorite       Boolean           @default(false)
  tags             String[]          @default([])
  notes            String            @default("") @db.Text
  /// Modality metadata; shape per modality in shared AssetMetadata union.
  metadata         Json              @default("{}")
  providerConfigId String?
  providerKind     ProviderKind
  providerModel    String?
  tier             ExecutionTier
  costUsd          Decimal?          @db.Decimal(12, 6)
  executionMs      Int?
  seed             Int?
  createdAt        DateTime          @default(now())
  updatedAt        DateTime          @updatedAt

  project      Project              @relation(fields: [projectId], references: [id], onDelete: Cascade)
  job          GenerationJob?       @relation(fields: [jobId], references: [id], onDelete: SetNull)
  parentAsset  GeneratedAsset?      @relation("AssetLineage", fields: [parentAssetId], references: [id], onDelete: SetNull)
  childAssets  GeneratedAsset[]     @relation("AssetLineage")
  files        GeneratedAssetFile[]
  savedToVault VaultFile?           @relation("AssetSavedToVault")

  @@index([projectId, modality, createdAt(sort: Desc)])
  @@index([assetGroupId, version])
  @@map("generated_assets")
}

model GeneratedAssetFile {
  id         String        @id @default(cuid())
  assetId    String
  role       AssetFileRole
  storageKey String        @unique
  fileName   String
  mimeType   String
  sizeBytes  Int
  width      Int?
  height     Int?
  durationMs Int?
  format     String
  sortIndex  Int           @default(0)
  createdAt  DateTime      @default(now())

  asset GeneratedAsset @relation(fields: [assetId], references: [id], onDelete: Cascade)

  @@index([assetId, role])
  @@map("generated_asset_files")
}
```

**Schema invariants enforced in services (not expressible in Prisma):**
1. Every project has exactly one root `VaultFolder` (`parentId = null`, `path = "/"`, `name = "Root"`), created in the same transaction as the project; root cannot be deleted/renamed.
2. At most one `MiddlemanProfile.isDefault = true` and one `isVisionDefault = true` (service clears others in a transaction).
3. For each `Modality`, at most one *enabled* provider lists it in `defaultForModalities`.
4. `MiddlemanTemplate` resolution: active project override (highest `version`) → active global (highest `version`).
5. `VaultFile.contentText` is required when `kind ∈ {MARKDOWN, TEXT, JSON}`; `storageKey` is required for binary kinds.
6. `GenerationJob.status` changes ONLY through `JobStateService.transition()` (§4.7) which validates against `JOB_TRANSITIONS`.

### 2.3 Shared enums (`/shared/src/enums/*`) — const-object pattern

All enums are `as const` objects plus a same-named union type, so values are structurally identical to Prisma-generated string unions.

```ts
// modality.enum.ts
export const Modality = {
  ICONS_2D: 'ICONS_2D', ASSETS_3D: 'ASSETS_3D', IMAGES: 'IMAGES', MUSIC: 'MUSIC',
  VOICES: 'VOICES', SFX: 'SFX', OTHER: 'OTHER',
} as const;
export type Modality = (typeof Modality)[keyof typeof Modality];
export const MODALITIES: readonly Modality[] = Object.values(Modality);

// context-scope.enum.ts
export const ContextScope = { ALWAYS_INCLUDE: 'ALWAYS_INCLUDE', ...Modality } as const;
export type ContextScope = (typeof ContextScope)[keyof typeof ContextScope];
export const CONTEXT_SCOPES: readonly ContextScope[] = Object.values(ContextScope);
/** Product-vocabulary labels shown in the UI and stored in DB via @map. */
export const CONTEXT_SCOPE_LABEL: Record<ContextScope, string> = {
  ALWAYS_INCLUDE: 'ALWAYS_INCLUDE', ICONS_2D: '2D_ICONS', ASSETS_3D: '3D_ASSETS', IMAGES: 'IMAGES',
  MUSIC: 'MUSIC', VOICES: 'VOICES', SFX: 'SFX', OTHER: 'OTHER',
};
export const modalityToScope = (m: Modality): ContextScope => m;

// job-status.enum.ts
export const JobStatus = {
  QUEUED: 'QUEUED', COMPILING: 'COMPILING', AWAITING_REVIEW: 'AWAITING_REVIEW', READY: 'READY',
  DISPATCHING: 'DISPATCHING', COLD_START: 'COLD_START', RUNNING: 'RUNNING', INGESTING: 'INGESTING',
  COMPLETED: 'COMPLETED', FAILED: 'FAILED', CANCELLED: 'CANCELLED',
} as const;
export type JobStatus = (typeof JobStatus)[keyof typeof JobStatus];

// execution.enum.ts
export const ExecutionMode = { AUTO_FIRE: 'AUTO_FIRE', INTERCEPT: 'INTERCEPT' } as const;
export type ExecutionMode = (typeof ExecutionMode)[keyof typeof ExecutionMode];
export const ExecutionTier = { CLOUD_API: 'CLOUD_API', RUNPOD: 'RUNPOD', LOCAL: 'LOCAL' } as const;
export type ExecutionTier = (typeof ExecutionTier)[keyof typeof ExecutionTier];
export const EXECUTION_TIER_LABEL: Record<ExecutionTier, string> = {
  CLOUD_API: 'Cloud API', RUNPOD: 'RunPod GPU', LOCAL: 'Local',
};

// provider.enum.ts  — ProviderKind mirrors Prisma exactly (19 values), ProviderRole {LLM,VISION,GENERATOR},
// HealthState {UNKNOWN,HEALTHY,DEGRADED,UNREACHABLE,UNAUTHORIZED}

// asset.enum.ts — ApprovalStatus, AssetFileRole, GenerationSubMode mirror Prisma exactly.
// vault.enum.ts — VaultFileKind, VisionStatus mirror Prisma exactly.

// error-code.enum.ts
export const ErrorCode = {
  VALIDATION_FAILED: 'VALIDATION_FAILED', NOT_FOUND: 'NOT_FOUND', CONFLICT: 'CONFLICT',
  INVALID_TRANSITION: 'INVALID_TRANSITION', PROVIDER_NOT_CONFIGURED: 'PROVIDER_NOT_CONFIGURED',
  PROVIDER_AUTH_FAILED: 'PROVIDER_AUTH_FAILED', PROVIDER_RATE_LIMITED: 'PROVIDER_RATE_LIMITED',
  PROVIDER_ERROR: 'PROVIDER_ERROR', PROVIDER_TIMEOUT: 'PROVIDER_TIMEOUT',
  MIDDLEMAN_PARSE_FAILED: 'MIDDLEMAN_PARSE_FAILED', MODALITY_UNSUPPORTED: 'MODALITY_UNSUPPORTED',
  STORAGE_ERROR: 'STORAGE_ERROR', PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE', INTERNAL: 'INTERNAL',
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
```

### 2.4 Shared constants

```ts
// constants/limits.ts
export const SEED_MAX = 2_147_483_647;
export const MAX_RAW_PROMPT_CHARS = 4000;
export const MAX_ENHANCED_PROMPT_CHARS = 8000;
export const MAX_NEGATIVE_PROMPT_CHARS = 2000;
export const MAX_PINNED_FILES = 12;
export const DEFAULT_CONTEXT_TOKEN_BUDGET = 12_000;
export const ICON_PREVIEW_SIZES = [512, 128, 64, 32] as const;
export const SFX_DURATION_RANGE = { min: 0.5, max: 22 } as const;
export const MUSIC_DURATION_RANGE = { min: 5, max: 300 } as const;

// constants/job-state-machine.ts
import { JobStatus } from '../enums';
export const TERMINAL_JOB_STATUSES: readonly JobStatus[] = ['COMPLETED', 'FAILED', 'CANCELLED'];
export const ACTIVE_JOB_STATUSES: readonly JobStatus[] =
  ['QUEUED', 'COMPILING', 'READY', 'DISPATCHING', 'COLD_START', 'RUNNING', 'INGESTING'];
export const JOB_TRANSITIONS: Readonly<Record<JobStatus, readonly JobStatus[]>> = {
  QUEUED:          ['COMPILING', 'READY', 'CANCELLED', 'FAILED'],
  COMPILING:       ['AWAITING_REVIEW', 'READY', 'FAILED', 'CANCELLED'],
  AWAITING_REVIEW: ['COMPILING', 'READY', 'CANCELLED'],
  READY:           ['DISPATCHING', 'CANCELLED', 'FAILED'],
  DISPATCHING:     ['COLD_START', 'RUNNING', 'INGESTING', 'FAILED', 'CANCELLED'],
  COLD_START:      ['RUNNING', 'INGESTING', 'FAILED', 'CANCELLED'],
  RUNNING:         ['INGESTING', 'FAILED', 'CANCELLED'],
  INGESTING:       ['COMPLETED', 'FAILED'],
  COMPLETED:       [],
  FAILED:          ['QUEUED'],        // only via POST /jobs/:id/retry (attempt++)
  CANCELLED:       [],
};
export const canTransition = (from: JobStatus, to: JobStatus): boolean =>
  JOB_TRANSITIONS[from].includes(to);
```

```mermaid
stateDiagram-v2
  [*] --> QUEUED
  QUEUED --> COMPILING: middleman enabled
  QUEUED --> READY: skipMiddleman
  COMPILING --> AWAITING_REVIEW: INTERCEPT
  COMPILING --> READY: AUTO_FIRE
  AWAITING_REVIEW --> COMPILING: recompile
  AWAITING_REVIEW --> READY: dispatch
  READY --> DISPATCHING: worker slot
  DISPATCHING --> COLD_START: remote queued, no warm worker
  DISPATCHING --> RUNNING: remote accepted
  DISPATCHING --> INGESTING: synchronous output
  COLD_START --> RUNNING
  RUNNING --> INGESTING
  INGESTING --> COMPLETED
  COMPILING --> FAILED
  RUNNING --> FAILED
  FAILED --> QUEUED: retry
  RUNNING --> CANCELLED
```

```ts
// constants/template-variables.ts — variables available to RunPod / ComfyUI / GenericHttp templates
export const TEMPLATE_VARIABLES = [
  'enhanced_prompt', 'negative_prompt', 'raw_prompt', 'seed', 'width', 'height', 'aspect_ratio',
  'steps', 'cfg_scale', 'batch_count', 'duration_seconds', 'bpm', 'key_signature', 'loop',
  'reference_image_b64', 'reference_image_url', 'reference_image_data_uri', 'voice_id',
  'transcript', 'speed', 'stability', 'target_polycount', 'texture_resolution', 'output_format',
  'model', 'job_id', 'project_slug',
] as const;
export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];
// Additionally: {{params.<anyKey>}} resolves from merged recommendedParams+userParams.

// constants/modality-meta.ts
export interface ModalityMeta {
  modality: Modality; label: string; route: string; icon: string; accentToken: string;
  description: string; outputKinds: Array<'image' | 'model' | 'audio' | 'text'>;
  acceptsReference: boolean; subModes: GenerationSubMode[];
}
export const MODALITY_META: Record<Modality, ModalityMeta> = {
  ICONS_2D:  { modality: 'ICONS_2D',  label: '2D Icons',      route: 'icons',  icon: 'icon-badge',  accentToken: 'violet',  description: 'Item icons, skill badges, rank emblems, UI buttons', outputKinds: ['image'], acceptsReference: true,  subModes: ['STANDARD'] },
  ASSETS_3D: { modality: 'ASSETS_3D', label: '3D Assets',     route: '3d',     icon: 'icon-cube',   accentToken: 'cyan',    description: 'Props, weapons, environment meshes, character bases', outputKinds: ['model', 'image'], acceptsReference: true, subModes: ['TEXT_TO_3D', 'IMAGE_TO_3D'] },
  IMAGES:    { modality: 'IMAGES',    label: 'Images',        route: 'images', icon: 'icon-image',  accentToken: 'violet',  description: 'Thumbnails, concept art, PBR textures, backgrounds, splash art', outputKinds: ['image'], acceptsReference: true, subModes: ['STANDARD'] },
  MUSIC:     { modality: 'MUSIC',     label: 'Music',         route: 'music',  icon: 'icon-music',  accentToken: 'emerald', description: 'Loopable BGM, combat tracks, ambience, stems', outputKinds: ['audio'], acceptsReference: false, subModes: ['STANDARD'] },
  VOICES:    { modality: 'VOICES',    label: 'Voices',        route: 'voices', icon: 'icon-mic',    accentToken: 'amber',   description: 'Character dialogue, voice design, NPC barks', outputKinds: ['audio'], acceptsReference: false, subModes: ['STANDARD'] },
  SFX:       { modality: 'SFX',       label: 'Sound Effects', route: 'sfx',    icon: 'icon-wave',   accentToken: 'cyan',    description: 'Hits, UI clicks, footsteps, magic foley', outputKinds: ['audio'], acceptsReference: false, subModes: ['STANDARD'] },
  OTHER:     { modality: 'OTHER',     label: 'Other Assets',  route: 'other',  icon: 'icon-layers', accentToken: 'violet',  description: 'Spritesheets, VFX textures, shader/Luau snippets, lore JSON', outputKinds: ['image', 'text'], acceptsReference: true, subModes: ['SPRITESHEET', 'VFX_TEXTURE', 'SHADER_CODE', 'LORE_JSON'] },
};
```

### 2.5 Zod schemas (`/shared/src/schemas/*`) — DTO source of truth

```ts
// common.schema.ts
import { z } from 'zod';
import { SEED_MAX } from '../constants/limits';
export const IdSchema = z.string().min(1).max(64);
export const HexColorSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/);
export const SeedSchema = z.number().int().min(0).max(SEED_MAX);
export const PaginationQuerySchema = z.object({
  cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(100).default(40),
});
export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;
export interface Paginated<T> { items: T[]; nextCursor: string | null; total: number; }
```

```ts
// project.schema.ts
export const CreateProjectSchema = z.object({
  name: z.string().trim().min(2).max(80),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(60).optional(), // derived from name if absent
  tagline: z.string().max(140).default(''),
  description: z.string().max(10_000).default(''),
  genre: z.string().max(60).default(''),
  accentHex: HexColorSchema.default('#7C3AED'),
  globalSummary: z.string().max(6000).default(''),
});
export const UpdateProjectSchema = CreateProjectSchema.partial().extend({ archived: z.boolean().optional() });
export type CreateProjectDto = z.infer<typeof CreateProjectSchema>;
export type UpdateProjectDto = z.infer<typeof UpdateProjectSchema>;
```

```ts
// vault.schema.ts
const ContextScopeEnum = z.enum(['ALWAYS_INCLUDE','ICONS_2D','ASSETS_3D','IMAGES','MUSIC','VOICES','SFX','OTHER']);
export const CreateFolderSchema = z.object({ parentId: IdSchema, name: z.string().trim().min(1).max(80).regex(/^[^/\\]+$/) });
export const UpdateFolderSchema = z.object({ name: z.string().trim().min(1).max(80).regex(/^[^/\\]+$/).optional(), parentId: IdSchema.optional(), sortOrder: z.number().int().optional() });
export const CreateTextFileSchema = z.object({
  folderId: IdSchema,
  name: z.string().trim().min(1).max(120).regex(/\.(md|txt|json)$/i),
  contentText: z.string().max(500_000).default(''),
  scopes: z.array(ContextScopeEnum).default([]),
  priority: z.number().int().min(0).max(100).default(50),
  description: z.string().max(500).default(''),
});
export const UpdateVaultFileSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  folderId: IdSchema.optional(),
  contentText: z.string().max(500_000).optional(),
  scopes: z.array(ContextScopeEnum).optional(),
  priority: z.number().int().min(0).max(100).optional(),
  description: z.string().max(500).optional(),
  styleDescriptorText: z.string().max(8000).nullable().optional(), // manual override allowed
});
/** multipart fields accompanying binary upload (file field name: "file") */
export const UploadVaultFileFieldsSchema = z.object({
  folderId: IdSchema,
  scopes: z.string().default('[]').transform((s) => z.array(ContextScopeEnum).parse(JSON.parse(s))),
  priority: z.coerce.number().int().min(0).max(100).default(50),
  runVision: z.enum(['true','false']).default('true').transform((v) => v === 'true'),
});
export const AnalyzeVisionSchema = z.object({ middlemanProfileId: IdSchema.optional() });
export const VaultSearchQuerySchema = z.object({
  q: z.string().max(120).default(''), scope: ContextScopeEnum.optional(),
  kind: z.enum(['MARKDOWN','TEXT','JSON','IMAGE','AUDIO','MODEL_3D','OTHER']).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
```

```ts
// provider.schema.ts
export const RunPodOutputAssetMappingSchema = z.object({
  path: z.string().min(1),                       // e.g. "output.images[*]" or "output.audio_url"
  encoding: z.enum(['base64', 'url', 'text', 'data_uri']),
  mimeType: z.string().optional(),               // required when encoding = base64/text
  role: z.enum(['PRIMARY','PREVIEW','STEM','FRAME','TEXTURE_BASE_COLOR','TEXTURE_NORMAL','TEXTURE_ORM','METADATA']).default('PRIMARY'),
});
export const OutputMappingSchema = z.object({
  assets: z.array(RunPodOutputAssetMappingSchema).min(1),
  progressPath: z.string().optional(),           // e.g. "output.progress" (0-1 or 0-100)
  errorPath: z.string().optional(),
  metadataPath: z.string().optional(),
});
export const ProviderSettingsSchema = z.object({
  timeoutMs: z.number().int().min(1000).max(3_600_000).default(120_000),
  pollIntervalMs: z.number().int().min(250).max(60_000).default(2000),
  maxPollIntervalMs: z.number().int().min(1000).max(120_000).default(15_000),
  maxConcurrency: z.number().int().min(1).max(32).default(2),
  costPerSecondUsd: z.number().min(0).default(0),
  costPerRequestUsd: z.number().min(0).default(0),
  executionTimeoutMs: z.number().int().min(10_000).max(86_400_000).default(600_000),
  ttlMs: z.number().int().min(60_000).max(604_800_000).default(86_400_000),
  useWebhook: z.boolean().default(false),
}).partial();
export const ModelOptionSchema = z.object({
  id: z.string().min(1), label: z.string().min(1),
  modalities: z.array(z.enum(['ICONS_2D','ASSETS_3D','IMAGES','MUSIC','VOICES','SFX','OTHER'])).default([]),
  roles: z.array(z.enum(['LLM','VISION','GENERATOR'])).default(['GENERATOR']),
  notes: z.string().optional(),
});
export const UpsertProviderSchema = z.object({
  name: z.string().trim().min(2).max(80),
  kind: z.enum(['ANTHROPIC','OPENAI','GEMINI','FAL','REPLICATE','STABILITY','MESHY','TRIPO3D','RODIN','ELEVENLABS','CARTESIA','FISH_AUDIO','RUNPOD_SERVERLESS','COMFYUI','A1111','OLLAMA','OPENAI_COMPATIBLE','GENERIC_HTTP','DEMO']),
  tier: z.enum(['CLOUD_API','RUNPOD','LOCAL']),
  roles: z.array(z.enum(['LLM','VISION','GENERATOR'])).min(1),
  modalities: z.array(z.enum(['ICONS_2D','ASSETS_3D','IMAGES','MUSIC','VOICES','SFX','OTHER'])).default([]),
  baseUrl: z.string().url().nullable().optional(),
  /** write-only. undefined = keep existing, null = clear, string = replace */
  secret: z.string().min(1).max(4096).nullable().optional(),
  runpodEndpointId: z.string().regex(/^[a-z0-9]{6,40}$/i).nullable().optional(),
  defaultModel: z.string().max(200).nullable().optional(),
  models: z.array(ModelOptionSchema).default([]),
  payloadTemplate: z.record(z.unknown()).nullable().optional(),
  outputMapping: OutputMappingSchema.nullable().optional(),
  workflowTemplate: z.record(z.unknown()).nullable().optional(),
  extraHeaders: z.record(z.string()).default({}),
  settings: ProviderSettingsSchema.default({}),
  defaultForModalities: z.array(z.enum(['ICONS_2D','ASSETS_3D','IMAGES','MUSIC','VOICES','SFX','OTHER'])).default([]),
  isEnabled: z.boolean().default(true),
}).superRefine((v, ctx) => {
  if (v.kind === 'RUNPOD_SERVERLESS' && !v.runpodEndpointId) ctx.addIssue({ code: 'custom', path: ['runpodEndpointId'], message: 'RunPod endpoint ID is required' });
  if (['RUNPOD_SERVERLESS','GENERIC_HTTP'].includes(v.kind) && !v.payloadTemplate) ctx.addIssue({ code: 'custom', path: ['payloadTemplate'], message: 'Payload template is required' });
  if (['RUNPOD_SERVERLESS','GENERIC_HTTP'].includes(v.kind) && !v.outputMapping) ctx.addIssue({ code: 'custom', path: ['outputMapping'], message: 'Output mapping is required' });
  if (v.kind === 'COMFYUI' && !v.workflowTemplate) ctx.addIssue({ code: 'custom', path: ['workflowTemplate'], message: 'ComfyUI workflow (API format) is required' });
  if (['COMFYUI','A1111','OLLAMA','OPENAI_COMPATIBLE','GENERIC_HTTP'].includes(v.kind) && !v.baseUrl) ctx.addIssue({ code: 'custom', path: ['baseUrl'], message: 'Base URL is required' });
});
export const TemplatePreviewSchema = z.object({
  template: z.record(z.unknown()),
  variables: z.record(z.unknown()),
});
export type UpsertProviderDto = z.infer<typeof UpsertProviderSchema>;
export type OutputMapping = z.infer<typeof OutputMappingSchema>;
export type ProviderSettings = z.infer<typeof ProviderSettingsSchema>;
```

```ts
// middleman.schema.ts
export const CompiledPromptSchema = z.object({
  assetTitle: z.string().trim().min(1).max(80),
  enhancedPrompt: z.string().trim().min(1).max(8000),
  negativePrompt: z.string().max(2000).default(''),
  recommendedParams: z.record(z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.string())])).default({}),
  contextSourcesUsed: z.array(z.object({
    fileId: z.string(), fileName: z.string(), reasoningNote: z.string().max(280),
  })).default([]),
  warnings: z.array(z.string().max(280)).max(10).default([]),
});
export type CompiledPrompt = z.infer<typeof CompiledPromptSchema>;

export const UpsertMiddlemanProfileSchema = z.object({
  name: z.string().trim().min(2).max(80),
  providerConfigId: IdSchema,
  model: z.string().min(1).max(200),
  temperature: z.number().min(0).max(2).default(0.4),
  maxOutputTokens: z.number().int().min(256).max(16_000).default(1600),
  maxContextTokens: z.number().int().min(1000).max(400_000).default(12_000),
  supportsVision: z.boolean().default(false),
  attachReferenceImages: z.boolean().default(false),
  maxReferenceImages: z.number().int().min(0).max(8).default(3),
  jsonMode: z.boolean().default(true),
  isDefault: z.boolean().default(false),
  isVisionDefault: z.boolean().default(false),
});
export const UpsertMiddlemanTemplateSchema = z.object({
  projectId: IdSchema.nullable().default(null),
  modality: z.enum(['ICONS_2D','ASSETS_3D','IMAGES','MUSIC','VOICES','SFX','OTHER']),
  name: z.string().trim().min(2).max(120),
  systemTemplate: z.string().min(50).max(30_000),
  defaultNegativePrompt: z.string().max(2000).default(''),
  hardConstraints: z.string().max(5000).default(''),
});
/** Stateless compile preview (does not create a job) */
export const CompilePreviewSchema = z.object({
  projectId: IdSchema,
  modality: z.enum(['ICONS_2D','ASSETS_3D','IMAGES','MUSIC','VOICES','SFX','OTHER']),
  rawPrompt: z.string().trim().min(1).max(4000),
  pinnedFileIds: z.array(IdSchema).max(12).default([]),
  params: z.lazy(() => ModalityParamsSchema),
  providerConfigId: IdSchema,
  middlemanProfileId: IdSchema.optional(),
});
```

```ts
// modality-params.schema.ts — discriminated union on `modality`
const seed = SeedSchema.nullable().default(null);
export const Icons2DParamsSchema = z.object({
  modality: z.literal('ICONS_2D'),
  iconCategory: z.enum(['ITEM', 'SKILL', 'RANK_EMBLEM', 'UI_BUTTON']).default('ITEM'),
  frameShape: z.enum(['NONE', 'CIRCLE', 'ROUNDED_SQUARE', 'HEXAGON', 'SHIELD', 'DIAMOND']).default('NONE'),
  removeBackground: z.boolean().default(true),
  solidBackgroundHex: HexColorSchema.nullable().default(null),   // used when removeBackground=false
  outputSize: z.union([z.literal(512), z.literal(1024)]).default(1024),
  batchCount: z.number().int().min(1).max(4).default(1),
  seed,
});
export const Assets3DParamsSchema = z.object({
  modality: z.literal('ASSETS_3D'),
  subMode: z.enum(['TEXT_TO_3D', 'IMAGE_TO_3D']).default('TEXT_TO_3D'),
  referenceStorageKey: z.string().nullable().default(null),       // required when IMAGE_TO_3D
  assetCategory: z.enum(['PROP', 'WEAPON', 'ENVIRONMENT', 'CHARACTER_BASE']).default('PROP'),
  polycountTier: z.enum(['LOW_POLY', 'MID_POLY', 'HIGH_RES']).default('LOW_POLY'),
  textureResolution: z.union([z.literal(1024), z.literal(2048), z.literal(4096)]).default(2048),
  outputFormat: z.enum(['glb', 'fbx', 'obj']).default('glb'),
  pose: z.enum(['NONE', 'T_POSE', 'A_POSE']).default('NONE'),
  enablePbr: z.boolean().default(true),
  topology: z.enum(['TRIANGLE', 'QUAD']).default('TRIANGLE'),
  seed,
}).superRefine((v, ctx) => {
  if (v.subMode === 'IMAGE_TO_3D' && !v.referenceStorageKey)
    ctx.addIssue({ code: 'custom', path: ['referenceStorageKey'], message: 'Image-to-3D requires a reference image' });
});
export const POLYCOUNT_TARGETS = { LOW_POLY: 5_000, MID_POLY: 30_000, HIGH_RES: 150_000 } as const;

export const ImagesParamsSchema = z.object({
  modality: z.literal('IMAGES'),
  imageCategory: z.enum(['THUMBNAIL', 'CONCEPT_ART', 'PBR_TEXTURE', 'BACKGROUND', 'SPLASH_ART']).default('CONCEPT_ART'),
  aspectPreset: z.enum(['SQUARE_1_1', 'THUMB_16_9', 'PORTRAIT_9_16', 'SEAMLESS_TILE']).default('SQUARE_1_1'),
  styleWeight: z.number().min(0).max(1).default(0.7),
  referenceStorageKey: z.string().nullable().default(null),
  referenceMode: z.enum(['NONE', 'IMG2IMG', 'CONTROLNET_CANNY', 'CONTROLNET_DEPTH', 'STYLE_REFERENCE']).default('NONE'),
  referenceStrength: z.number().min(0).max(1).default(0.55),
  batchCount: z.number().int().min(1).max(4).default(1),
  seed,
});
export const ASPECT_DIMENSIONS = {
  SQUARE_1_1: { width: 1024, height: 1024, ratio: '1:1' },
  THUMB_16_9: { width: 1536, height: 864, ratio: '16:9' },
  PORTRAIT_9_16: { width: 864, height: 1536, ratio: '9:16' },
  SEAMLESS_TILE: { width: 1024, height: 1024, ratio: '1:1' },
} as const;

export const MusicParamsSchema = z.object({
  modality: z.literal('MUSIC'),
  trackType: z.enum(['BGM_LOOP', 'COMBAT', 'AMBIENT', 'STINGER', 'MENU']).default('BGM_LOOP'),
  durationSec: z.number().min(5).max(300).default(60),
  bpm: z.number().int().min(40).max(220).nullable().default(null),   // null = let Middleman decide
  keySignature: z.string().max(24).nullable().default(null),
  seamlessLoop: z.boolean().default(true),
  instrumentalOnly: z.boolean().default(true),
  generateStems: z.boolean().default(false),
  outputFormat: z.enum(['wav', 'mp3']).default('wav'),
  seed,
});
export const VoicesParamsSchema = z.object({
  modality: z.literal('VOICES'),
  transcript: z.string().max(5000).default(''),   // non-empty enforced by CreateJobSchema.superRefine
  voiceProfileId: IdSchema.nullable().default(null),
  lineType: z.enum(['DIALOGUE', 'BARK', 'NARRATION']).default('DIALOGUE'),
  emotionTags: z.array(z.enum(['NEUTRAL','ANGRY','JOYFUL','SAD','FEARFUL','WHISPER','SHOUT','SARCASTIC','HEROIC','MENACING','TIRED','PLAYFUL'])).max(4).default(['NEUTRAL']),
  speed: z.number().min(0.7).max(1.3).default(1),
  stability: z.number().min(0).max(1).default(0.5),
  similarityBoost: z.number().min(0).max(1).default(0.75),
  style: z.number().min(0).max(1).default(0.3),
  outputFormat: z.enum(['wav', 'mp3']).default('wav'),
  batchCount: z.number().int().min(1).max(3).default(1),
  seed,
});
export const SfxParamsSchema = z.object({
  modality: z.literal('SFX'),
  sfxCategory: z.enum(['WEAPON_HIT','UI_CLICK','FOOTSTEP','MAGIC','AMBIENT_FOLEY','EXPLOSION','CREATURE','IMPACT']).default('WEAPON_HIT'),
  durationSec: z.number().min(0.5).max(22).default(1.5),
  loopable: z.boolean().default(false),
  promptInfluence: z.number().min(0).max(1).default(0.45),
  variationCount: z.number().int().min(1).max(8).default(4),
  outputFormat: z.enum(['wav', 'mp3', 'ogg']).default('wav'),
  seed,
});
export const OtherParamsSchema = z.object({
  modality: z.literal('OTHER'),
  subMode: z.enum(['SPRITESHEET', 'VFX_TEXTURE', 'SHADER_CODE', 'LORE_JSON']),
  spritesheet: z.object({
    frameCount: z.number().int().min(2).max(64).default(16),
    columns: z.number().int().min(1).max(8).default(4),
    frameSize: z.union([z.literal(64), z.literal(128), z.literal(256), z.literal(512)]).default(256),
    animationType: z.enum(['IDLE', 'ATTACK', 'CAST', 'EXPLOSION', 'LOOP_FX', 'WALK']).default('LOOP_FX'),
    fps: z.number().int().min(4).max(60).default(12),
  }).default({}),
  vfx: z.object({
    textureType: z.enum(['PARTICLE', 'MASK', 'NOISE', 'TRAIL', 'FLIPBOOK']).default('PARTICLE'),
    grayscale: z.boolean().default(true),
    tileable: z.boolean().default(false),
    resolution: z.union([z.literal(256), z.literal(512), z.literal(1024)]).default(512),
  }).default({}),
  shader: z.object({
    language: z.enum(['LUAU', 'GDSCRIPT', 'GODOT_SHADER', 'HLSL', 'GLSL']).default('LUAU'),
    targetEngine: z.enum(['ROBLOX', 'GODOT', 'UNITY', 'GENERIC']).default('ROBLOX'),
  }).default({}),
  loreJson: z.object({
    schemaKind: z.enum(['ITEM_TABLE', 'DIALOGUE_TREE', 'QUEST', 'NPC_ROSTER']).default('ITEM_TABLE'),
    entryCount: z.number().int().min(1).max(50).default(8),
    customSchema: z.string().max(8000).nullable().default(null),
  }).default({}),
  seed,
});
export const ModalityParamsSchema = z.discriminatedUnion('modality', [
  Icons2DParamsSchema, Assets3DParamsSchema.innerType(), ImagesParamsSchema, MusicParamsSchema,
  VoicesParamsSchema, SfxParamsSchema, OtherParamsSchema,
]);
// NOTE: discriminatedUnion cannot hold ZodEffects; Assets3D refinement is re-applied in JobsService.validateParams().
export type ModalityParams = z.infer<typeof ModalityParamsSchema>;
export type ParamsFor<M extends Modality> = Extract<ModalityParams, { modality: M }>;
export const defaultParamsFor = <M extends Modality>(m: M): ParamsFor<M> =>
  ModalityParamsSchema.parse({ modality: m, ...(m === 'OTHER' ? { subMode: 'SPRITESHEET' } : {}) }) as ParamsFor<M>;
```

```ts
// job.schema.ts
export const CreateJobSchema = z.object({
  projectId: IdSchema,
  executionMode: z.enum(['AUTO_FIRE', 'INTERCEPT']),
  rawPrompt: z.string().trim().min(1).max(4000),
  pinnedFileIds: z.array(IdSchema).max(12).default([]),
  params: ModalityParamsSchema,
  /** Adapter-level ParamSpec overrides from the Advanced panel; merged last into mergedParams. */
  advanced: z.record(z.union([z.string(), z.number(), z.boolean()])).default({}),
  providerConfigId: IdSchema,
  providerModel: z.string().max(200).nullable().default(null),
  middlemanProfileId: IdSchema.nullable().default(null),   // null => default profile
  skipMiddleman: z.boolean().default(false),
  parentAssetId: IdSchema.nullable().default(null),        // "regenerate/variation of"
}).superRefine((v, ctx) => {
  if (v.params.modality === 'VOICES' && v.params.transcript.trim().length === 0)
    ctx.addIssue({ code: 'custom', path: ['params', 'transcript'], message: 'Transcript is required for voice generation' });
  if (v.params.modality === 'ASSETS_3D') {
    const r = Assets3DParamsSchema.safeParse(v.params);          // re-apply refinement lost in the union
    if (!r.success) r.error.issues.forEach((i) => ctx.addIssue({ ...i, path: ['params', ...i.path] }));
  }
});
export const UpdateCompiledSchema = z.object({ compiled: CompiledPromptSchema });
export const RecompileSchema = z.object({ rawPrompt: z.string().trim().min(1).max(4000).optional(), pinnedFileIds: z.array(IdSchema).max(12).optional() });
export const JobListQuerySchema = z.object({
  projectId: IdSchema,
  modality: z.enum(['ICONS_2D','ASSETS_3D','IMAGES','MUSIC','VOICES','SFX','OTHER']).optional(),
  status: z.string().optional().transform((s) => (s ? s.split(',') : undefined)),
  active: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().optional(),
});
export type CreateJobDto = z.infer<typeof CreateJobSchema>;
```

```ts
// asset.schema.ts
export const AssetListQuerySchema = z.object({
  projectId: IdSchema,
  modality: z.enum(['ICONS_2D','ASSETS_3D','IMAGES','MUSIC','VOICES','SFX','OTHER']).optional(),
  approval: z.enum(['DRAFT','APPROVED','REJECTED','FINAL']).optional(),
  favorite: z.enum(['true','false']).optional(),
  tier: z.enum(['CLOUD_API','RUNPOD','LOCAL']).optional(),
  q: z.string().max(120).optional(),
  sort: z.enum(['newest', 'oldest', 'cost', 'duration']).default('newest'),
  limit: z.coerce.number().int().min(1).max(100).default(40),
  cursor: z.string().optional(),
});
export const UpdateAssetSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  approval: z.enum(['DRAFT','APPROVED','REJECTED','FINAL']).optional(),
  isFavorite: z.boolean().optional(),
  tags: z.array(z.string().trim().min(1).max(32)).max(20).optional(),
  notes: z.string().max(5000).optional(),
});
export const SaveAssetToVaultSchema = z.object({
  folderId: IdSchema,
  scopes: z.array(z.enum(['ALWAYS_INCLUDE','ICONS_2D','ASSETS_3D','IMAGES','MUSIC','VOICES','SFX','OTHER'])).min(1),
  runVision: z.boolean().default(true),
  fileRole: z.enum(['PRIMARY', 'THUMBNAIL', 'PREVIEW']).default('PRIMARY'),
});
// voice-profile.schema.ts
export const UpsertVoiceProfileSchema = z.object({
  name: z.string().trim().min(1).max(80),
  characterSheetFileId: IdSchema.nullable().default(null),
  providerConfigId: IdSchema.nullable().default(null),
  externalVoiceId: z.string().max(200).default(''),
  description: z.string().max(4000).default(''),
  defaultSettings: z.object({
    speed: z.number().min(0.7).max(1.3).optional(), stability: z.number().min(0).max(1).optional(),
    similarityBoost: z.number().min(0).max(1).optional(), style: z.number().min(0).max(1).optional(),
    emotionTags: z.array(z.string()).optional(),
  }).default({}),
});
```

### 2.6 Read models (`/shared/src/models/*`)

```ts
export interface ProjectModel {
  id: string; slug: string; name: string; tagline: string; description: string; genre: string;
  accentHex: string; coverUrl: string | null; globalSummary: string; archived: boolean;
  stats: { vaultFiles: number; assets: number; activeJobs: number; totalCostUsd: number };
  createdAt: string; updatedAt: string;
}
export interface VaultFolderModel {
  id: string; projectId: string; parentId: string | null; name: string; path: string;
  sortOrder: number; fileCount: number; children: VaultFolderModel[];   // tree endpoint fills children
}
export interface VaultFileModel {
  id: string; projectId: string; folderId: string; folderPath: string; name: string; extension: string;
  kind: VaultFileKind; mimeType: string; sizeBytes: number; scopes: ContextScope[]; priority: number;
  description: string; tokenEstimate: number; contentUrl: string | null; thumbnailUrl: string | null;
  styleDescriptorText: string | null; styleDescriptorJson: StyleDescriptor | null;
  visionStatus: VisionStatus; visionModel: string | null; visionError: string | null;
  width: number | null; height: number | null; durationMs: number | null;
  sourceAssetId: string | null; createdAt: string; updatedAt: string;
}
export interface VaultFileDetailModel extends VaultFileModel { contentText: string | null; }
export interface StyleDescriptor {
  paletteHex: string[]; lighting: string; rendering: string; linework: string; proportions: string;
  materials: string; composition: string; mood: string; doNot: string[];
}
export interface ProviderConfigModel {
  id: string; name: string; kind: ProviderKind; tier: ExecutionTier; roles: ProviderRole[];
  modalities: Modality[]; baseUrl: string | null; hasSecret: boolean; secretLast4: string | null;
  runpodEndpointId: string | null; defaultModel: string | null; models: ModelOption[];
  payloadTemplate: Record<string, unknown> | null; outputMapping: OutputMapping | null;
  workflowTemplate: Record<string, unknown> | null; extraHeaders: Record<string, string>;
  settings: ProviderSettings; defaultForModalities: Modality[]; isEnabled: boolean;
  health: { state: HealthState; latencyMs: number | null; message: string | null; checkedAt: string | null };
  createdAt: string; updatedAt: string;
}
export interface ProviderCatalogEntry {
  kind: ProviderKind; label: string; tier: ExecutionTier; roles: ProviderRole[];
  modalities: Modality[]; requiresSecret: boolean; requiresBaseUrl: boolean; defaultBaseUrl: string | null;
  secretLabel: string; docsUrl: string; suggestedModels: ModelOption[];
  editorFields: Array<'baseUrl'|'secret'|'runpodEndpointId'|'payloadTemplate'|'outputMapping'|'workflowTemplate'|'extraHeaders'>;
}
export interface ParamSpec {
  key: string; label: string; type: 'number' | 'integer' | 'boolean' | 'enum' | 'string';
  min?: number; max?: number; step?: number; options?: Array<{ value: string; label: string }>;
  default: string | number | boolean | null; description: string; advanced: boolean;
}
export interface AdapterDescriptor {
  adapterId: string; providerKind: ProviderKind; modality: Modality; subModes: GenerationSubMode[];
  supportsNegativePrompt: boolean; supportsSeed: boolean; supportsReferenceImage: boolean;
  supportsBatch: boolean; maxPromptChars: number; paramSpecs: ParamSpec[];
}
export interface MiddlemanProfileModel { id: string; name: string; providerConfigId: string; providerName: string; providerKind: ProviderKind; tier: ExecutionTier; model: string; temperature: number; maxOutputTokens: number; maxContextTokens: number; supportsVision: boolean; attachReferenceImages: boolean; maxReferenceImages: number; jsonMode: boolean; isDefault: boolean; isVisionDefault: boolean; }
export interface MiddlemanTemplateModel { id: string; projectId: string | null; modality: Modality; name: string; systemTemplate: string; defaultNegativePrompt: string; hardConstraints: string; version: number; isActive: boolean; updatedAt: string; }
export interface CompilePreviewResult { compiled: CompiledPrompt; systemPrompt: string; userMessage: string; contextFiles: ContextFileRef[]; droppedFiles: ContextFileRef[]; usage: LlmUsage; }
export interface ContextFileRef { fileId: string; fileName: string; folderPath: string; reason: 'PINNED' | 'ALWAYS_INCLUDE' | 'SCOPE'; tokens: number; truncated: boolean; }
export interface LlmUsage { inputTokens: number; outputTokens: number; latencyMs: number; model: string; }

export interface JobModel {
  id: string; projectId: string; modality: Modality; subMode: GenerationSubMode; executionMode: ExecutionMode;
  status: JobStatus; rawPrompt: string; pinnedFileIds: string[]; params: ModalityParams;
  compiled: CompiledPrompt | null; edited: CompiledPrompt | null; contextFiles: ContextFileRef[];
  providerConfigId: string; providerName: string; providerKind: ProviderKind; providerModel: string | null;
  tier: ExecutionTier; middlemanProfileId: string | null; middlemanProfileName: string | null;
  externalJobId: string | null; externalStatus: string | null; progressPercent: number; progressStage: string | null;
  coldStartMs: number | null; queueDelayMs: number | null; executionMs: number | null; costUsd: number | null;
  errorCode: string | null; errorMessage: string | null; attempt: number; assetIds: string[];
  createdAt: string; dispatchedAt: string | null; startedAt: string | null; completedAt: string | null;
}
export interface JobEventModel { id: string; type: string; fromStatus: JobStatus | null; toStatus: JobStatus | null; message: string; payload: unknown; createdAt: string; }

export interface AssetFileModel { id: string; role: AssetFileRole; url: string; downloadUrl: string; fileName: string; mimeType: string; sizeBytes: number; width: number | null; height: number | null; durationMs: number | null; format: string; }
export type AssetMetadata =
  | { modality: 'ICONS_2D'; width: number; height: number; hasAlpha: boolean; frameShape: string; iconCategory: string }
  | { modality: 'ASSETS_3D'; format: string; triangleCount: number | null; vertexCount: number | null; textureResolution: number; hasPbr: boolean; boundingBox: [number, number, number] | null }
  | { modality: 'IMAGES'; width: number; height: number; aspectPreset: string; tileable: boolean }
  | { modality: 'MUSIC'; durationMs: number; bpm: number | null; keySignature: string | null; loop: boolean; sampleRate: number; stems: string[] }
  | { modality: 'VOICES'; durationMs: number; voiceProfileId: string | null; transcript: string; alignment: VoiceAlignment | null; sampleRate: number }
  | { modality: 'SFX'; durationMs: number; loopable: boolean; variationIndex: number; sampleRate: number }
  | { modality: 'OTHER'; subMode: GenerationSubMode; frameCount?: number; columns?: number; frameSize?: number; fps?: number; language?: string; schemaKind?: string; lineCount?: number };
export interface VoiceAlignment { words: Array<{ word: string; startMs: number; endMs: number }>; }
export interface AssetModel {
  id: string; projectId: string; jobId: string | null; modality: Modality; subMode: GenerationSubMode;
  title: string; assetGroupId: string; version: number; batchIndex: number; parentAssetId: string | null;
  rawPrompt: string; enhancedPrompt: string; negativePrompt: string; approval: ApprovalStatus; isFavorite: boolean;
  tags: string[]; notes: string; metadata: AssetMetadata; providerKind: ProviderKind; providerName: string | null;
  providerModel: string | null; tier: ExecutionTier; costUsd: number | null; executionMs: number | null;
  seed: number | null; files: AssetFileModel[]; primaryUrl: string; thumbnailUrl: string | null;
  savedToVaultFileId: string | null; createdAt: string;
}
export interface VoiceProfileModel { id: string; projectId: string; name: string; characterSheetFileId: string | null; characterSheetName: string | null; providerConfigId: string | null; providerName: string | null; externalVoiceId: string; description: string; defaultSettings: Record<string, unknown>; sampleUrl: string | null; }
```

URL fields are always server-relative: `contentUrl = /api/v1/media/vault/:fileId`, `thumbnailUrl = /api/v1/media/vault/:fileId/thumbnail`, asset file `url = /api/v1/media/assets/:assetFileId`, `downloadUrl = url + '?download=1'`.

### 2.7 WebSocket event contracts (`/shared/src/events/ws-events.ts`)

```ts
export const WS_NAMESPACE = '/orchestrator';
export interface JobCreatedEvent      { job: JobModel }
export interface JobStatusEvent       { jobId: string; projectId: string; from: JobStatus; to: JobStatus; at: string; message: string }
export interface MiddlemanChunkEvent  { jobId: string; projectId: string; seq: number; delta: string; accumulatedChars: number }
export interface MiddlemanCompleteEvent { jobId: string; projectId: string; compiled: CompiledPrompt; contextFiles: ContextFileRef[]; usage: LlmUsage; nextStatus: 'AWAITING_REVIEW' | 'READY' }
export interface MiddlemanErrorEvent  { jobId: string; projectId: string; code: ErrorCode; message: string; rawOutputExcerpt: string }
export interface WorkerStatusEvent {
  jobId: string; projectId: string; tier: ExecutionTier; providerKind: ProviderKind;
  externalJobId: string | null; externalStatus: string;
  phase: 'SUBMITTED' | 'IN_QUEUE' | 'COLD_START' | 'WARM' | 'RUNNING' | 'UPLOADING' | 'DONE';
  coldStart: boolean; queueDelayMs: number | null;
  workers: { idle: number; running: number; initializing: number; throttled: number } | null;
  at: string;
}
export interface JobProgressEvent  { jobId: string; projectId: string; percent: number; stage: string; message: string; etaMs: number | null }
export interface JobCompletedEvent { jobId: string; projectId: string; assets: AssetModel[]; costUsd: number | null; executionMs: number | null }
export interface JobFailedEvent    { jobId: string; projectId: string; code: string; message: string; retryable: boolean }
export interface VaultFileUpdatedEvent { projectId: string; file: VaultFileModel }
export interface ProviderHealthEvent { providerConfigId: string; state: HealthState; latencyMs: number | null; message: string | null }

export interface ServerToClientEvents {
  'job:created': (p: JobCreatedEvent) => void;
  'job:status': (p: JobStatusEvent) => void;
  'job:middleman-chunk': (p: MiddlemanChunkEvent) => void;
  'job:middleman-complete': (p: MiddlemanCompleteEvent) => void;
  'job:middleman-error': (p: MiddlemanErrorEvent) => void;
  'job:worker-status': (p: WorkerStatusEvent) => void;
  'job:progress': (p: JobProgressEvent) => void;
  'job:completed': (p: JobCompletedEvent) => void;
  'job:failed': (p: JobFailedEvent) => void;
  'vault:file-updated': (p: VaultFileUpdatedEvent) => void;
  'provider:health': (p: ProviderHealthEvent) => void;
}
export interface Ack { ok: boolean; error?: string }
export interface ClientToServerEvents {
  'studio:subscribe-project': (p: { projectId: string }, ack: (a: Ack) => void) => void;
  'studio:unsubscribe-project': (p: { projectId: string }, ack: (a: Ack) => void) => void;
  'job:subscribe': (p: { jobId: string }, ack: (a: Ack & { replay?: MiddlemanChunkEvent[] }) => void) => void;
}
export const roomForProject = (id: string) => `project:${id}`;
export const roomForJob = (id: string) => `job:${id}`;
```

### 2.8 Shared utilities — exact algorithms

**`template-interpolation.ts`** — type-preserving, JSON-safe:
```ts
const WHOLE = /^\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}$/;
const INLINE = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;
export interface InterpolationResult { value: unknown; missing: string[]; used: string[] }
export function resolveVar(vars: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, k) =>
    acc !== null && typeof acc === 'object' ? (acc as Record<string, unknown>)[k] : undefined, vars);
}
export function interpolateTemplate(template: unknown, vars: Record<string, unknown>): InterpolationResult {
  const missing = new Set<string>(); const used = new Set<string>();
  const walk = (node: unknown): unknown => {
    if (typeof node === 'string') {
      const whole = WHOLE.exec(node);
      if (whole) { const key = whole[1]!; const v = resolveVar(vars, key); used.add(key);
        if (v === undefined) { missing.add(key); return null; } return v; }        // preserves number/bool/object
      return node.replace(INLINE, (_m, key: string) => { used.add(key); const v = resolveVar(vars, key);
        if (v === undefined || v === null) { missing.add(key); return ''; }
        return typeof v === 'string' ? v : JSON.stringify(v); });
    }
    if (Array.isArray(node)) return node.map(walk);
    if (node !== null && typeof node === 'object')
      return Object.fromEntries(Object.entries(node as Record<string, unknown>).map(([k, v]) => [k, walk(v)]));
    return node;
  };
  return { value: walk(template), missing: [...missing], used: [...used] };
}
```
Unit tests MUST cover: whole-string number stays number; inline string concatenation; nested objects/arrays; missing vars reported; `{{params.steps}}` path.

**`json-path.ts`** — `selectPath(obj, "output.images[*].base64")` returns `unknown[]` (always an array; `[*]` flattens arrays; numeric index `[0]` supported; missing → `[]`).

**`mention-parser.ts`** — `extractMentions(text): string[]` using `/(?:^|\s)@([\w][\w.\-]*(?:\/[\w.\-]+)*)/g`; returns unique lowercase tokens without `@`; `stripMentions(text)` removes the `@` prefix but keeps the name in prose; `toMentionAlias(name) = name.trim().replace(/\s+/g, '-')`; `normalizeForMention(name) = toMentionAlias(name).toLowerCase()` (used by the backend resolver so `@color-palette.md` matches `Color Palette.md`).

**`token-estimate.ts`** — `estimateTokens(s) = Math.ceil(s.length / 3.8)`; `truncateToTokens(s, max)` cuts at last paragraph/line boundary ≤ `max*3.8` chars and appends `\n…[truncated]`.

**`word-diff.ts`** — tokenise by `/(\s+|[,.;:!?()])/` keeping separators; LCS DP (O(n·m), cap each side at 1500 tokens else fall back to whole-block replace); output `Array<{ op: 'equal' | 'insert' | 'delete'; text: string }>` with adjacent same-op segments merged.
