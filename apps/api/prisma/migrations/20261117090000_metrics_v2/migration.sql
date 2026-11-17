-- P07-1 metrics_v2 (DATA_MODEL_V2 §5): daily metric snapshots and deterministic impact scores v2.
-- v0.1 scores were LLM-generated (AI-01): they are kept untouched in impact_scores_legacy, never
-- displayed, and dropped in P15. No data is migrated.

-- 1. Rename the v0.1 table and its constraints/indexes so the new table can reuse the names.
ALTER TABLE "impact_scores" RENAME TO "impact_scores_legacy";
ALTER TABLE "impact_scores_legacy" RENAME CONSTRAINT "impact_scores_pkey" TO "impact_scores_legacy_pkey";
ALTER TABLE "impact_scores_legacy" RENAME CONSTRAINT "impact_scores_userId_fkey" TO "impact_scores_legacy_userId_fkey";
ALTER INDEX "impact_scores_userId_month_year_key" RENAME TO "impact_scores_legacy_userId_month_year_key";

-- 2. Score status enum.
CREATE TYPE "ScoreStatus" AS ENUM ('OK', 'INSUFFICIENT_DATA');

-- 3. New impact_scores (lazy cache per user/period/version, KPI_METHODOLOGY §6.6).
CREATE TABLE "impact_scores" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "period_type" "PeriodType" NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "timezone" TEXT NOT NULL,
    "score_version" TEXT NOT NULL,
    "metrics_version" TEXT NOT NULL,
    "status" "ScoreStatus" NOT NULL,
    "overall" DOUBLE PRECISION,
    "delivery" DOUBLE PRECISION,
    "quality" DOUBLE PRECISION,
    "collaboration" DOUBLE PRECISION,
    "ownership" DOUBLE PRECISION,
    "inputs" JSONB NOT NULL,
    "explanation" TEXT NOT NULL,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "impact_scores_pkey" PRIMARY KEY ("id")
);

-- 4. Daily snapshots (additive counters only, KPI_METHODOLOGY §4).
CREATE TABLE "metric_snapshots" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "timezone" TEXT NOT NULL,
    "commits" INTEGER NOT NULL DEFAULT 0,
    "prs_opened" INTEGER NOT NULL DEFAULT 0,
    "prs_merged" INTEGER NOT NULL DEFAULT 0,
    "prs_closed_unmerged" INTEGER NOT NULL DEFAULT 0,
    "reviews_submitted" INTEGER NOT NULL DEFAULT 0,
    "prs_reviewed" INTEGER NOT NULL DEFAULT 0,
    "review_comments" INTEGER NOT NULL DEFAULT 0,
    "achievements" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "metrics_version" TEXT NOT NULL,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "metric_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "metric_snapshots_user_id_date_key" ON "metric_snapshots"("user_id", "date");
CREATE UNIQUE INDEX "impact_scores_user_id_period_type_period_start_period_end_s_key" ON "impact_scores"("user_id", "period_type", "period_start", "period_end", "score_version");
CREATE INDEX "impact_scores_user_id_period_start_period_end_idx" ON "impact_scores"("user_id", "period_start", "period_end");

ALTER TABLE "metric_snapshots" ADD CONSTRAINT "metric_snapshots_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "impact_scores" ADD CONSTRAINT "impact_scores_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
