-- CreateEnum
CREATE TYPE "Modality" AS ENUM ('ICONS_2D', 'ASSETS_3D', 'IMAGES', 'MUSIC', 'VOICES', 'SFX', 'OTHER');

-- CreateEnum
CREATE TYPE "ContextScope" AS ENUM ('ALWAYS_INCLUDE', '2D_ICONS', '3D_ASSETS', 'IMAGES', 'MUSIC', 'VOICES', 'SFX', 'OTHER');

-- CreateEnum
CREATE TYPE "VaultFileKind" AS ENUM ('MARKDOWN', 'TEXT', 'JSON', 'IMAGE', 'AUDIO', 'MODEL_3D', 'OTHER');

-- CreateEnum
CREATE TYPE "VisionStatus" AS ENUM ('NONE', 'PENDING', 'RUNNING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "ExecutionTier" AS ENUM ('CLOUD_API', 'RUNPOD', 'LOCAL');

-- CreateEnum
CREATE TYPE "ProviderRole" AS ENUM ('LLM', 'VISION', 'GENERATOR');

-- CreateEnum
CREATE TYPE "ProviderKind" AS ENUM ('ANTHROPIC', 'OPENAI', 'GEMINI', 'FAL', 'REPLICATE', 'STABILITY', 'MESHY', 'TRIPO3D', 'RODIN', 'ELEVENLABS', 'CARTESIA', 'FISH_AUDIO', 'RUNPOD_SERVERLESS', 'COMFYUI', 'A1111', 'OLLAMA', 'OPENAI_COMPATIBLE', 'GENERIC_HTTP', 'DEMO');

-- CreateEnum
CREATE TYPE "HealthState" AS ENUM ('UNKNOWN', 'HEALTHY', 'DEGRADED', 'UNREACHABLE', 'UNAUTHORIZED');

-- CreateEnum
CREATE TYPE "ExecutionMode" AS ENUM ('AUTO_FIRE', 'INTERCEPT');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'COMPILING', 'AWAITING_REVIEW', 'READY', 'DISPATCHING', 'COLD_START', 'RUNNING', 'INGESTING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "GenerationSubMode" AS ENUM ('STANDARD', 'TEXT_TO_3D', 'IMAGE_TO_3D', 'SPRITESHEET', 'VFX_TEXTURE', 'SHADER_CODE', 'LORE_JSON');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('DRAFT', 'APPROVED', 'REJECTED', 'FINAL');

-- CreateEnum
CREATE TYPE "AssetFileRole" AS ENUM ('PRIMARY', 'THUMBNAIL', 'PREVIEW', 'VARIANT_512', 'VARIANT_128', 'VARIANT_64', 'VARIANT_32', 'TEXTURE_BASE_COLOR', 'TEXTURE_NORMAL', 'TEXTURE_ORM', 'STEM', 'FRAME', 'ALIGNMENT', 'METADATA', 'SOURCE_REFERENCE');

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tagline" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "genre" TEXT NOT NULL DEFAULT '',
    "accentHex" TEXT NOT NULL DEFAULT '#7C3AED',
    "coverStorageKey" TEXT,
    "globalSummary" TEXT NOT NULL DEFAULT '',
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vault_folders" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vault_folders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vault_files" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "folderId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "extension" TEXT NOT NULL,
    "kind" "VaultFileKind" NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL DEFAULT 0,
    "checksumSha256" TEXT,
    "contentText" TEXT,
    "storageKey" TEXT,
    "thumbnailKey" TEXT,
    "scopes" "ContextScope"[] DEFAULT ARRAY[]::"ContextScope"[],
    "priority" INTEGER NOT NULL DEFAULT 50,
    "description" TEXT NOT NULL DEFAULT '',
    "tokenEstimate" INTEGER NOT NULL DEFAULT 0,
    "styleDescriptorText" TEXT,
    "styleDescriptorJson" JSONB,
    "visionStatus" "VisionStatus" NOT NULL DEFAULT 'NONE',
    "visionModel" TEXT,
    "visionError" TEXT,
    "visionAnalyzedAt" TIMESTAMP(3),
    "width" INTEGER,
    "height" INTEGER,
    "durationMs" INTEGER,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "sourceAssetId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vault_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voice_profiles" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "characterSheetFileId" TEXT,
    "providerConfigId" TEXT,
    "externalVoiceId" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "defaultSettings" JSONB NOT NULL DEFAULT '{}',
    "sampleStorageKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "voice_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_provider_configs" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "ProviderKind" NOT NULL,
    "tier" "ExecutionTier" NOT NULL,
    "roles" "ProviderRole"[],
    "modalities" "Modality"[],
    "baseUrl" TEXT,
    "encryptedSecret" TEXT,
    "secretLast4" TEXT,
    "runpodEndpointId" TEXT,
    "defaultModel" TEXT,
    "models" JSONB NOT NULL DEFAULT '[]',
    "payloadTemplate" JSONB,
    "outputMapping" JSONB,
    "workflowTemplate" JSONB,
    "extraHeaders" JSONB NOT NULL DEFAULT '{}',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "defaultForModalities" "Modality"[] DEFAULT ARRAY[]::"Modality"[],
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "healthState" "HealthState" NOT NULL DEFAULT 'UNKNOWN',
    "healthLatencyMs" INTEGER,
    "healthMessage" TEXT,
    "healthCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_provider_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "middleman_profiles" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "providerConfigId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "temperature" DOUBLE PRECISION NOT NULL DEFAULT 0.4,
    "maxOutputTokens" INTEGER NOT NULL DEFAULT 1600,
    "maxContextTokens" INTEGER NOT NULL DEFAULT 12000,
    "supportsVision" BOOLEAN NOT NULL DEFAULT false,
    "attachReferenceImages" BOOLEAN NOT NULL DEFAULT false,
    "maxReferenceImages" INTEGER NOT NULL DEFAULT 3,
    "jsonMode" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isVisionDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "middleman_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "middleman_templates" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "modality" "Modality" NOT NULL,
    "name" TEXT NOT NULL,
    "systemTemplate" TEXT NOT NULL,
    "defaultNegativePrompt" TEXT NOT NULL DEFAULT '',
    "hardConstraints" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "middleman_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "generation_jobs" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "modality" "Modality" NOT NULL,
    "subMode" "GenerationSubMode" NOT NULL DEFAULT 'STANDARD',
    "executionMode" "ExecutionMode" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "rawPrompt" TEXT NOT NULL,
    "pinnedFileIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "userParams" JSONB NOT NULL,
    "referenceStorageKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "skipMiddleman" BOOLEAN NOT NULL DEFAULT false,
    "middlemanProfileId" TEXT,
    "middlemanTemplateId" TEXT,
    "middlemanRawOutput" TEXT,
    "compiledPayload" JSONB,
    "editedPayload" JSONB,
    "contextFileIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "middlemanUsage" JSONB,
    "middlemanStartedAt" TIMESTAMP(3),
    "middlemanCompletedAt" TIMESTAMP(3),
    "providerConfigId" TEXT NOT NULL,
    "providerModel" TEXT,
    "tier" "ExecutionTier" NOT NULL,
    "externalJobId" TEXT,
    "externalStatus" TEXT,
    "remoteHandle" JSONB,
    "seed" INTEGER,
    "batchCount" INTEGER NOT NULL DEFAULT 1,
    "progressPercent" INTEGER NOT NULL DEFAULT 0,
    "progressStage" TEXT,
    "coldStartMs" INTEGER,
    "queueDelayMs" INTEGER,
    "executionMs" INTEGER,
    "costUsd" DECIMAL(12,6),
    "pollCount" INTEGER NOT NULL DEFAULT 0,
    "nextPollAt" TIMESTAMP(3),
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "parentJobId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dispatchedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "generation_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "generation_job_events" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "fromStatus" "JobStatus",
    "toStatus" "JobStatus",
    "message" TEXT NOT NULL DEFAULT '',
    "payload" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "generation_job_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "generated_assets" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "jobId" TEXT,
    "modality" "Modality" NOT NULL,
    "subMode" "GenerationSubMode" NOT NULL DEFAULT 'STANDARD',
    "title" TEXT NOT NULL,
    "assetGroupId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "batchIndex" INTEGER NOT NULL DEFAULT 0,
    "parentAssetId" TEXT,
    "rawPrompt" TEXT NOT NULL,
    "enhancedPrompt" TEXT NOT NULL,
    "negativePrompt" TEXT NOT NULL DEFAULT '',
    "approval" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "isFavorite" BOOLEAN NOT NULL DEFAULT false,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT NOT NULL DEFAULT '',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "providerConfigId" TEXT,
    "providerKind" "ProviderKind" NOT NULL,
    "providerModel" TEXT,
    "tier" "ExecutionTier" NOT NULL,
    "costUsd" DECIMAL(12,6),
    "executionMs" INTEGER,
    "seed" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "generated_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "generated_asset_files" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "role" "AssetFileRole" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "durationMs" INTEGER,
    "format" TEXT NOT NULL,
    "sortIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "generated_asset_files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "projects_slug_key" ON "projects"("slug");

-- CreateIndex
CREATE INDEX "vault_folders_projectId_parentId_idx" ON "vault_folders"("projectId", "parentId");

-- CreateIndex
CREATE UNIQUE INDEX "vault_folders_projectId_path_key" ON "vault_folders"("projectId", "path");

-- CreateIndex
CREATE UNIQUE INDEX "vault_files_sourceAssetId_key" ON "vault_files"("sourceAssetId");

-- CreateIndex
CREATE INDEX "vault_files_projectId_kind_idx" ON "vault_files"("projectId", "kind");

-- CreateIndex
CREATE INDEX "vault_files_scopes_idx" ON "vault_files" USING GIN ("scopes");

-- CreateIndex
CREATE UNIQUE INDEX "vault_files_folderId_name_key" ON "vault_files"("folderId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "voice_profiles_projectId_name_key" ON "voice_profiles"("projectId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ai_provider_configs_name_key" ON "ai_provider_configs"("name");

-- CreateIndex
CREATE INDEX "ai_provider_configs_kind_idx" ON "ai_provider_configs"("kind");

-- CreateIndex
CREATE UNIQUE INDEX "middleman_profiles_name_key" ON "middleman_profiles"("name");

-- CreateIndex
CREATE INDEX "middleman_templates_modality_isActive_idx" ON "middleman_templates"("modality", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "middleman_templates_projectId_modality_version_key" ON "middleman_templates"("projectId", "modality", "version");

-- CreateIndex
CREATE INDEX "generation_jobs_status_nextPollAt_idx" ON "generation_jobs"("status", "nextPollAt");

-- CreateIndex
CREATE INDEX "generation_jobs_projectId_modality_createdAt_idx" ON "generation_jobs"("projectId", "modality", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "generation_job_events_jobId_createdAt_idx" ON "generation_job_events"("jobId", "createdAt");

-- CreateIndex
CREATE INDEX "generated_assets_projectId_modality_createdAt_idx" ON "generated_assets"("projectId", "modality", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "generated_assets_assetGroupId_version_idx" ON "generated_assets"("assetGroupId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "generated_asset_files_storageKey_key" ON "generated_asset_files"("storageKey");

-- CreateIndex
CREATE INDEX "generated_asset_files_assetId_role_idx" ON "generated_asset_files"("assetId", "role");

-- AddForeignKey
ALTER TABLE "vault_folders" ADD CONSTRAINT "vault_folders_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vault_folders" ADD CONSTRAINT "vault_folders_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "vault_folders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vault_files" ADD CONSTRAINT "vault_files_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vault_files" ADD CONSTRAINT "vault_files_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "vault_folders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vault_files" ADD CONSTRAINT "vault_files_sourceAssetId_fkey" FOREIGN KEY ("sourceAssetId") REFERENCES "generated_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voice_profiles" ADD CONSTRAINT "voice_profiles_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voice_profiles" ADD CONSTRAINT "voice_profiles_characterSheetFileId_fkey" FOREIGN KEY ("characterSheetFileId") REFERENCES "vault_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voice_profiles" ADD CONSTRAINT "voice_profiles_providerConfigId_fkey" FOREIGN KEY ("providerConfigId") REFERENCES "ai_provider_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "middleman_profiles" ADD CONSTRAINT "middleman_profiles_providerConfigId_fkey" FOREIGN KEY ("providerConfigId") REFERENCES "ai_provider_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "middleman_templates" ADD CONSTRAINT "middleman_templates_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_middlemanProfileId_fkey" FOREIGN KEY ("middlemanProfileId") REFERENCES "middleman_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_middlemanTemplateId_fkey" FOREIGN KEY ("middlemanTemplateId") REFERENCES "middleman_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_providerConfigId_fkey" FOREIGN KEY ("providerConfigId") REFERENCES "ai_provider_configs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_parentJobId_fkey" FOREIGN KEY ("parentJobId") REFERENCES "generation_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generation_job_events" ADD CONSTRAINT "generation_job_events_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "generation_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generated_assets" ADD CONSTRAINT "generated_assets_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generated_assets" ADD CONSTRAINT "generated_assets_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "generation_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generated_assets" ADD CONSTRAINT "generated_assets_parentAssetId_fkey" FOREIGN KEY ("parentAssetId") REFERENCES "generated_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generated_asset_files" ADD CONSTRAINT "generated_asset_files_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "generated_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
