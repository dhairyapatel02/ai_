-- P05-3 (DATA_MODEL_V2 §5, ADR-0004, ADR-0005): integration security columns + GitHub App installations.
-- v0.1 OAuth App tokens are DROPPED, not encrypted: they cannot drive the GitHub App and keeping
-- them only extends exposure. Affected integrations become NEEDS_REAUTH. After this migration no
-- plaintext provider token remains in the database. Take a pg_dump before running in production.

-- CreateEnum
CREATE TYPE "IntegrationMechanism" AS ENUM ('GITHUB_APP', 'OAUTH_APP');

-- CreateEnum
CREATE TYPE "IntegrationStatus" AS ENUM ('ACTIVE', 'NEEDS_REAUTH', 'SUSPENDED', 'DISCONNECTED', 'ERROR');

-- DropIndex (one GitHub account -> one user replaces one integration per user and provider)
DROP INDEX "integrations_userId_provider_key";

-- AlterTable: add the v2 columns
ALTER TABLE "integrations"
ADD COLUMN     "access_token_enc" TEXT,
ADD COLUMN     "access_token_expires_at" TIMESTAMP(3),
ADD COLUMN     "avatar_url" TEXT,
ADD COLUMN     "backfill_from" TIMESTAMP(3),
ADD COLUMN     "disconnected_at" TIMESTAMP(3),
ADD COLUMN     "display_name" TEXT,
ADD COLUMN     "external_account_id" TEXT,
ADD COLUMN     "external_login" TEXT,
ADD COLUMN     "last_successful_sync_at" TIMESTAMP(3),
ADD COLUMN     "last_synced_at" TIMESTAMP(3),
ADD COLUMN     "mechanism" "IntegrationMechanism" NOT NULL DEFAULT 'GITHUB_APP',
ADD COLUMN     "permissions" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "refresh_token_enc" TEXT,
ADD COLUMN     "refresh_token_expires_at" TIMESTAMP(3),
ADD COLUMN     "schedule_slot_minute" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "status" "IntegrationStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "status_reason" TEXT,
ADD COLUMN     "sync_cursor" JSONB NOT NULL DEFAULT '{}';

-- Data step: every existing (v0.1 OAuth App) integration keeps its activity rows but must be
-- reconnected through the GitHub App. Profile fields are backfilled from the v0.1 metadata JSON.
UPDATE "integrations" SET
  "external_login" = NULLIF("metadata"->>'username', ''),
  "display_name"   = NULLIF("metadata"->>'name', ''),
  "avatar_url"     = NULLIF("metadata"->>'avatar', ''),
  "mechanism"      = 'OAUTH_APP',
  "status"         = 'NEEDS_REAUTH',
  "status_reason"  = 'MIGRATED_FROM_V0';

-- Drop plaintext tokens and the metadata blob (after the backfill above).
ALTER TABLE "integrations" DROP COLUMN "accessToken",
DROP COLUMN "refreshToken",
DROP COLUMN "metadata";

-- CreateTable
CREATE TABLE "github_installations" (
    "id" TEXT NOT NULL,
    "integration_id" TEXT NOT NULL,
    "installation_id" BIGINT NOT NULL,
    "account_login" TEXT NOT NULL,
    "account_type" TEXT NOT NULL,
    "repository_selection" TEXT NOT NULL,
    "suspended_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "github_installations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "github_installations_installation_id_idx" ON "github_installations"("installation_id");

-- CreateIndex
CREATE UNIQUE INDEX "github_installations_integration_id_installation_id_key" ON "github_installations"("integration_id", "installation_id");

-- CreateIndex
CREATE INDEX "integrations_userId_provider_idx" ON "integrations"("userId", "provider");

-- CreateIndex
CREATE INDEX "integrations_status_schedule_slot_minute_idx" ON "integrations"("status", "schedule_slot_minute");

-- CreateIndex
CREATE UNIQUE INDEX "integrations_provider_external_account_id_key" ON "integrations"("provider", "external_account_id");

-- AddForeignKey
ALTER TABLE "github_installations" ADD CONSTRAINT "github_installations_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
