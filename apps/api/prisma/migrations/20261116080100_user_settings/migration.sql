-- P05-2 (DATA_MODEL_V2 §5): per-user settings (IANA timezone etc., D-019).

-- CreateEnum
CREATE TYPE "PeriodType" AS ENUM ('MONTH', 'QUARTER', 'HALF', 'YEAR', 'CUSTOM');

-- CreateTable
CREATE TABLE "user_settings" (
    "user_id" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "current_role" VARCHAR(100),
    "career_level" VARCHAR(100),
    "target_role" VARCHAR(100),
    "default_period_type" "PeriodType" NOT NULL DEFAULT 'MONTH',
    "digest_enabled" BOOLEAN NOT NULL DEFAULT false,
    "digest_day_of_week" INTEGER NOT NULL DEFAULT 1,
    "digest_hour_local" INTEGER NOT NULL DEFAULT 9,
    "notify_sync_failures" BOOLEAN NOT NULL DEFAULT true,
    "notify_document_ready" BOOLEAN NOT NULL DEFAULT false,
    "ai_redact_private_repos" BOOLEAN NOT NULL DEFAULT false,
    "onboarding_step" TEXT,
    "onboarding_completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_settings_pkey" PRIMARY KEY ("user_id")
);

-- AddForeignKey
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Data step: a default settings row (timezone UTC) for every existing user.
INSERT INTO "user_settings" ("user_id", "updated_at")
SELECT "id", CURRENT_TIMESTAMP FROM "users"
ON CONFLICT ("user_id") DO NOTHING;
