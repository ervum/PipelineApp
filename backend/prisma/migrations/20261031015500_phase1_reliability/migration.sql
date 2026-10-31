-- AlterTable
ALTER TABLE "vault_files" ADD COLUMN "visionAttempts" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "generation_jobs" ADD COLUMN "notBefore" TIMESTAMP(3),
ADD COLUMN "maxAttempts" INTEGER NOT NULL DEFAULT 3;

-- CreateTable
CREATE TABLE "mcp_invocation_logs" (
    "id" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "transport" TEXT NOT NULL DEFAULT 'HTTP_RPC',
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "isError" BOOLEAN NOT NULL DEFAULT false,
    "argsSummary" TEXT NOT NULL DEFAULT '',
    "assetIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "primaryAssetUrl" TEXT,
    "primaryModality" "Modality",
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mcp_invocation_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "mcp_invocation_logs_createdAt_idx" ON "mcp_invocation_logs"("createdAt" DESC);
