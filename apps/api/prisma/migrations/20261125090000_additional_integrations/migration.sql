-- P13-1 additional_integrations (Phase 13, D-029/D-030): GitLab / Jira / Linear.
-- * Issue v2 columns (DATA_MODEL_V2 Issue, KPI_METHODOLOGY §3.6). v0.1 never synced issues; the only
--   rows that can exist are synthetic seed placeholders attached to GitHub integrations, so they are
--   removed before the NOT NULL columns are added (re-created by `npm run db:seed`).
-- * provider_identities (identity linking), integrations.base_url + config, SyncStage ISSUES,
--   IntegrationMechanism OAUTH2, metric_snapshots issue counters + per-provider counters.

-- CreateEnum
CREATE TYPE "IdentityKind" AS ENUM ('ACCOUNT', 'USERNAME', 'EMAIL');

-- CreateEnum
CREATE TYPE "IdentitySource" AS ENUM ('PROVIDER', 'MANUAL');

-- AlterEnum
ALTER TYPE "IntegrationMechanism" ADD VALUE 'OAUTH2';

-- AlterEnum
ALTER TYPE "SyncStage" ADD VALUE 'ISSUES';

-- DropIndex
DROP INDEX "issues_userId_timestamp_idx";

-- AlterTable
ALTER TABLE "integrations" ADD COLUMN     "base_url" TEXT,
ADD COLUMN     "config" JSONB NOT NULL DEFAULT '{}';

-- Synthetic placeholder rows only (see header).
DELETE FROM "issues";

-- AlterTable
ALTER TABLE "issues" DROP COLUMN "projectName",
DROP COLUMN "storyPoints",
DROP COLUMN "timestamp",
ADD COLUMN     "canceled_at" TIMESTAMP(3),
ADD COLUMN     "completed_at" TIMESTAMP(3),
ADD COLUMN     "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "created_at_remote" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "cycle_name" TEXT,
ADD COLUMN     "external_id" TEXT NOT NULL,
ADD COLUMN     "key" TEXT NOT NULL,
ADD COLUMN     "project_key" TEXT,
ADD COLUMN     "project_name" TEXT,
ADD COLUMN     "site_id" TEXT,
ADD COLUMN     "started_at" TIMESTAMP(3),
ADD COLUMN     "status_name" TEXT,
ADD COLUMN     "story_points" DOUBLE PRECISION,
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "updated_at_remote" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "url" TEXT;

-- AlterTable
ALTER TABLE "metric_snapshots" ADD COLUMN     "by_provider" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "issues_completed" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "story_points" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "provider_identities" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "integration_id" TEXT NOT NULL,
    "provider" "Provider" NOT NULL,
    "kind" "IdentityKind" NOT NULL,
    "value" TEXT NOT NULL,
    "source" "IdentitySource" NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_identities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "provider_identities_user_id_idx" ON "provider_identities"("user_id");

-- CreateIndex
CREATE INDEX "provider_identities_integration_id_idx" ON "provider_identities"("integration_id");

-- CreateIndex
CREATE UNIQUE INDEX "provider_identities_provider_kind_value_key" ON "provider_identities"("provider", "kind", "value");

-- CreateIndex
CREATE INDEX "issues_userId_completed_at_idx" ON "issues"("userId", "completed_at");

-- CreateIndex
CREATE INDEX "issues_userId_updated_at_remote_idx" ON "issues"("userId", "updated_at_remote");

-- CreateIndex
CREATE UNIQUE INDEX "issues_integrationId_external_id_key" ON "issues"("integrationId", "external_id");

-- AddForeignKey
ALTER TABLE "provider_identities" ADD CONSTRAINT "provider_identities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_identities" ADD CONSTRAINT "provider_identities_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

