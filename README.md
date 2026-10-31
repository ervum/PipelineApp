# ForgeStudio Control Room

**ForgeStudio Control Room** is a multi-modal AI game & media asset generation studio featuring a **Project Context Vault**, a **Middleman LLM Prompt Compiler**, and a unified **Cloud API / RunPod Serverless / Local GPU** execution engine across 7 modalities (`2D Icons`, `3D Assets`, `Images`, `Music`, `Voices`, `Sound Effects`, and `Other Assets`).

---

## Architecture Summary

- **`/shared` (`@forge/shared`)**: Dual ESM/CJS TypeScript package containing all domain enums, constants, Zod validation schemas, read models, WebSocket contracts (`/orchestrator`), and pure runtime-agnostic utilities (`interpolateTemplate`, `selectPath`, `extractMentions`, `estimateTokens`, `wordDiff`).
- **`/backend` (`@forge/backend`)**: NestJS 11 + Prisma 6 + PostgreSQL 16 + Socket.IO + Sharp + AES-256-GCM provider secret encryption + procedural media synthesizer (`src/synth/*`) + 21-provider adapter matrix + `FOR UPDATE SKIP LOCKED` job worker.
- **`/frontend` (`@forge/frontend`)**: Angular standalone zoneless studio UI with a bespoke pure Dart Sass design system, Three.js 3D viewport, and Web Audio API waveform/loop auditioning.

---

## Quickstart Setup

### Prerequisites
- **Node.js**: `>= 22.11` (see `.nvmrc`)
- **npm**: `>= 10.9`
- **Docker**: Running locally for PostgreSQL 16 (`docker-compose.yml`)

### Step-by-Step Setup

1. **Install dependencies**
   ```bash
   npm i
   ```

2. **Start PostgreSQL 16**
   ```bash
   npm run db:up
   ```

3. **Generate a 32-byte master encryption key**
   ```bash
   npm run keygen -w @forge/backend
   ```

4. **Create `backend/.env` from `backend/.env.example`**
   ```bash
   cp backend/.env.example backend/.env
   # Paste the generated base64 key into FORGE_MASTER_KEY in backend/.env
   ```

5. **Build shared contracts, run Prisma migrations, and seed the database**
   ```bash
   npm run build:shared
   npm run prisma:migrate -w @forge/backend
   npm run seed -w @forge/backend
   ```
   *(Or run `npm run db:reset` to reset, migrate, and seed in one step.)*

6. **Run the development servers**
   ```bash
   npm run dev
   ```

---

## Workspace Scripts

| Command | Description |
| :--- | :--- |
| `npm run db:up` | Start PostgreSQL 16 container via Docker Compose |
| `npm run build:shared` | Build `@forge/shared` (ESM + CJS + d.ts) |
| `npm run db:reset` | Reset database, apply migrations, and execute deterministic seed (`prisma:reset`) |
| `npm run test` | Run unit tests in `@forge/shared` and `@forge/backend` |
| `npm run test -w @forge/frontend` | Run headless Karma/Jasmine unit tests in `@forge/frontend` |
| `npm run lint` | Run ESLint (strict TypeScript, zero `any`) and `scripts/check-forbidden-deps.mjs` |
| `npm run dev` | Watch `@forge/shared`, `@forge/backend`, and `@forge/frontend` concurrently |

---

## Manual Smoke Verification Checklist (§5.15)

1. **Seeded Projects & Context Switching**:
   - Open `http://localhost:4200`. Verify all 3 seeded projects (*Aetherblade Chronicles*, *Neon Drift: 2099*, *Cozy Sprout Island*) appear in the Project Switcher (`Ctrl/Cmd+P`), and switching projects updates `--project-accent` and the Context Bar vault file count.
2. **All 7 Generator Workspaces & Demo Pipeline**:
   - Visit `/generate/icons`, `/generate/3d`, `/generate/images`, `/generate/music`, `/generate/voices`, `/generate/sfx`, and `/generate/other`.
   - Test **Auto-Fire** (`Ctrl+Enter`) and **Intercept & Review** (`Ctrl+Shift+Enter` or `Compile Prompt First`) with the **ForgeStudio Demo Engine**:
     - Observe live Middleman token streaming in `MiddlemanStatusPillComponent`.
     - In Intercept mode, inspect the 6 tabs (`Diff`, `Enhanced`, `Negative`, `Params`, `Context Sources`, `Raw`) in `CompileReviewDrawerComponent`, edit the prompt, and click **Dispatch to Generator**.
     - When `seed % 3 === 0` (e.g., `seed = 3`), observe the simulated `COLD_START` worker state transition before `RUNNING` and `COMPLETED`.
3. **Interactive Previews**:
   - **2D Icons**: Toggle checkerboard/dark/light/accent backgrounds, Silhouette Check, and inspect the 512/128/64/32 1:1 pixel strip and HUD slot.
   - **3D Assets**: Orbit/pan/zoom the seeded `.glb` meshes in `ModelViewportComponent`, toggle Wireframe/Grid/Auto-Rotate, switch lighting rigs (`Studio 3-Point`, `Neutral PBR`, `Outdoor Sun`, `Rim Dramatic`), verify triangle/vertex/material/bounds stats, and capture a PNG screenshot.
   - **Images**: Pan/zoom, toggle 3×3 Seamless Tile preview with `tileSeamScore`, and drag the A/B comparison split handle.
   - **Music**: Play/loop tracks in `DualWaveformPlayerComponent`, audition the **Loop Seam Inspector** (with RMS jump in dB), and toggle Mute/Solo on stem lanes.
   - **Voices**: Play character lines in `VoiceAlignmentViewComponent`, observe synchronized word highlighting, and click words to seek.
   - **SFX**: Audition variations with number keys `1–8` or **Play All Sequentially**.
   - **Other**: Play animated flipbooks in `SpritesheetPlayerComponent` (with FPS, Ping-Pong, and 30% Onion Skin), view tokenized code in `CodePreviewComponent`, and browse structured lore in `JsonTreeViewComponent`.
4. **History & Asset Inspector + Project Vault IDE + Providers**:
   - Select any asset in `AssetHistoryDrawerComponent`, edit its title/approval/tags/notes, view the split Prompt Diff, click **Save as Reference to Project Vault**, **Create Variation**, or **Re-run with Edits**.
   - In `/vault`, edit Markdown files with live preview + hex colour swatches, tag scopes, and run Vision analysis on reference images.
   - In `/providers`, create or edit a RunPod provider and verify live client-side `{{variable}}` interpolation in `RunPodTemplateEditorComponent`.
