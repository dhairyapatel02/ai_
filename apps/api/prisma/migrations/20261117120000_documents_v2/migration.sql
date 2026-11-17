-- P08-1 documents_v2 (DATA_MODEL_V2 §5): documents v2, versions, AI usage.
-- Data step: every v0.1 document becomes a read-only DocumentVersion v1 `{ legacy: true, raw }`.
-- Run `pg_dump` before applying in production (runbook, P14).

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('PENDING', 'STREAMING', 'READY', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "VersionSource" AS ENUM ('AI', 'USER_EDIT', 'RESTORE');

-- CreateEnum
CREATE TYPE "AiFeature" AS ENUM ('RESUME', 'APPRAISAL', 'PROMOTION', 'IMPACT_NARRATIVE', 'ACHIEVEMENT_STATEMENT', 'DIGEST_SUMMARY');

-- CreateEnum
CREATE TYPE "AiCallStatus" AS ENUM ('SUCCEEDED', 'FAILED', 'CANCELLED');

-- AlterEnum: add the v2 types, remove KPI (never written by v0.1; a KPI row makes the cast fail
-- loudly instead of losing data).
CREATE TYPE "DocumentType_new" AS ENUM ('RESUME', 'APPRAISAL', 'PROMOTION', 'IMPACT_NARRATIVE', 'ACHIEVEMENT_STATEMENT', 'DIGEST_SUMMARY');
ALTER TABLE "generated_documents" ALTER COLUMN "type" TYPE "DocumentType_new" USING ("type"::text::"DocumentType_new");
ALTER TYPE "DocumentType" RENAME TO "DocumentType_old";
ALTER TYPE "DocumentType_new" RENAME TO "DocumentType";
DROP TYPE "public"."DocumentType_old";

-- DropIndex
DROP INDEX "generated_documents_userId_type_idx";

-- AlterTable: new columns (NOT NULL ones are filled for legacy rows below, then constrained)
ALTER TABLE "generated_documents"
ADD COLUMN     "citation_coverage" DOUBLE PRECISION,
ADD COLUMN     "current_version" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "error_code" TEXT,
ADD COLUMN     "evidence_refs" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "flags_invalid" INTEGER,
ADD COLUMN     "flags_uncited" INTEGER,
ADD COLUMN     "input_hash" TEXT,
ADD COLUMN     "model" TEXT,
ADD COLUMN     "options" JSONB,
ADD COLUMN     "period_end" DATE,
ADD COLUMN     "period_start" DATE,
ADD COLUMN     "prompt_id" TEXT,
ADD COLUMN     "prompt_version" INTEGER,
ADD COLUMN     "source_impact_score_id" TEXT,
ADD COLUMN     "status" "DocumentStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "timezone" TEXT,
ADD COLUMN     "title" VARCHAR(200),
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "document_versions" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "content" JSONB NOT NULL,
    "source" "VersionSource" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_versions_pkey" PRIMARY KEY ("id")
);

-- Data step: import v0.1 documents as read-only versions.
UPDATE "generated_documents" SET
  "title" = CASE "type"
              WHEN 'RESUME' THEN 'Resume (imported)'
              WHEN 'APPRAISAL' THEN 'Appraisal (imported)'
              WHEN 'PROMOTION' THEN 'Promotion (imported)'
              ELSE 'Document (imported)'
            END,
  "status" = 'READY',
  "current_version" = 1,
  "options" = jsonb_build_object('dateRange', "dateRange"),
  "period_start" = CASE WHEN "dateRange"->>'from' ~ '^\d{4}-\d{2}-\d{2}'
                        THEN left("dateRange"->>'from', 10)::date END,
  "period_end"   = CASE WHEN "dateRange"->>'to' ~ '^\d{4}-\d{2}-\d{2}'
                        THEN left("dateRange"->>'to', 10)::date END,
  "prompt_id" = 'legacy',
  "prompt_version" = 0,
  "model" = 'unknown',
  "input_hash" = 'legacy:' || "id",
  "updated_at" = "createdAt";

INSERT INTO "document_versions" ("id", "document_id", "version", "content", "source", "created_at")
SELECT 'v' || "id", "id", 1, jsonb_build_object('legacy', true, 'raw', "content"), 'AI', "createdAt"
FROM "generated_documents";

ALTER TABLE "generated_documents"
ALTER COLUMN "input_hash" SET NOT NULL,
ALTER COLUMN "model" SET NOT NULL,
ALTER COLUMN "options" SET NOT NULL,
ALTER COLUMN "prompt_id" SET NOT NULL,
ALTER COLUMN "prompt_version" SET NOT NULL,
ALTER COLUMN "title" SET NOT NULL,
DROP COLUMN "content",
DROP COLUMN "dateRange";

-- CreateTable
CREATE TABLE "ai_usage" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "document_id" TEXT,
    "feature" "AiFeature" NOT NULL,
    "prompt_id" TEXT NOT NULL,
    "prompt_version" INTEGER NOT NULL,
    "model" TEXT NOT NULL,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "cache_read_tokens" INTEGER NOT NULL DEFAULT 0,
    "cache_write_tokens" INTEGER NOT NULL DEFAULT 0,
    "cost_micro_usd" BIGINT NOT NULL DEFAULT 0,
    "latency_ms" INTEGER NOT NULL,
    "status" "AiCallStatus" NOT NULL,
    "counts_toward_quota" BOOLEAN NOT NULL DEFAULT true,
    "error_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "document_versions_document_id_version_key" ON "document_versions"("document_id", "version");

-- CreateIndex
CREATE INDEX "ai_usage_user_id_created_at_idx" ON "ai_usage"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_usage_user_id_feature_created_at_idx" ON "ai_usage"("user_id", "feature", "created_at");

-- CreateIndex
CREATE INDEX "generated_documents_userId_type_createdAt_idx" ON "generated_documents"("userId", "type", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "generated_documents_userId_input_hash_idx" ON "generated_documents"("userId", "input_hash");

-- AddForeignKey
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "generated_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "generated_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
