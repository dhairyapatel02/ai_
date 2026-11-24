-- P12-1 career_os (DATA_MODEL_V2 §5): achievements (+ evidence with an exactly-one CHECK), goals,
-- goal_achievements, digest_deliveries. Settings columns already exist (P05-2). No data step.

-- CreateEnum
CREATE TYPE "AchievementCategory" AS ENUM ('DELIVERY', 'QUALITY', 'MENTORING', 'INCIDENT', 'LEADERSHIP', 'LEARNING', 'COLLABORATION', 'OTHER');

-- CreateEnum
CREATE TYPE "AchievementSource" AS ENUM ('MANUAL', 'FROM_ACTIVITY', 'SUGGESTED');

-- CreateEnum
CREATE TYPE "EvidenceKind" AS ENUM ('PULL_REQUEST', 'COMMIT', 'REVIEW');

-- CreateEnum
CREATE TYPE "GoalStatus" AS ENUM ('ACTIVE', 'ACHIEVED', 'MISSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "GoalComparator" AS ENUM ('LTE', 'GTE');

-- CreateEnum
CREATE TYPE "DigestStatus" AS ENUM ('SENT', 'SKIPPED', 'FAILED');

-- CreateTable
CREATE TABLE "achievements" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "impact" TEXT,
    "category" "AchievementCategory" NOT NULL,
    "occurred_on" DATE NOT NULL,
    "links" JSONB NOT NULL DEFAULT '[]',
    "source" "AchievementSource" NOT NULL DEFAULT 'MANUAL',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "achievements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "achievement_evidence" (
    "id" TEXT NOT NULL,
    "achievement_id" TEXT NOT NULL,
    "kind" "EvidenceKind" NOT NULL,
    "pull_request_id" TEXT,
    "commit_id" TEXT,
    "review_id" TEXT,

    CONSTRAINT "achievement_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goals" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "status" "GoalStatus" NOT NULL DEFAULT 'ACTIVE',
    "start_date" DATE NOT NULL,
    "target_date" DATE,
    "metric_key" TEXT,
    "comparator" "GoalComparator",
    "target_value" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "goals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goal_achievements" (
    "goal_id" TEXT NOT NULL,
    "achievement_id" TEXT NOT NULL,

    CONSTRAINT "goal_achievements_pkey" PRIMARY KEY ("goal_id","achievement_id")
);

-- CreateTable
CREATE TABLE "digest_deliveries" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "week_start" DATE NOT NULL,
    "status" "DigestStatus" NOT NULL,
    "error" TEXT,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "digest_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "achievements_user_id_occurred_on_idx" ON "achievements"("user_id", "occurred_on");

-- CreateIndex
CREATE INDEX "achievement_evidence_achievement_id_idx" ON "achievement_evidence"("achievement_id");

-- CreateIndex
CREATE INDEX "achievement_evidence_pull_request_id_idx" ON "achievement_evidence"("pull_request_id");

-- CreateIndex
CREATE INDEX "achievement_evidence_commit_id_idx" ON "achievement_evidence"("commit_id");

-- CreateIndex
CREATE INDEX "achievement_evidence_review_id_idx" ON "achievement_evidence"("review_id");

-- CreateIndex
CREATE INDEX "goals_user_id_status_idx" ON "goals"("user_id", "status");

-- CreateIndex
CREATE INDEX "goal_achievements_achievement_id_idx" ON "goal_achievements"("achievement_id");

-- CreateIndex
CREATE UNIQUE INDEX "digest_deliveries_user_id_week_start_key" ON "digest_deliveries"("user_id", "week_start");

-- AddForeignKey
ALTER TABLE "achievements" ADD CONSTRAINT "achievements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "achievement_evidence" ADD CONSTRAINT "achievement_evidence_achievement_id_fkey" FOREIGN KEY ("achievement_id") REFERENCES "achievements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "achievement_evidence" ADD CONSTRAINT "achievement_evidence_pull_request_id_fkey" FOREIGN KEY ("pull_request_id") REFERENCES "pull_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "achievement_evidence" ADD CONSTRAINT "achievement_evidence_commit_id_fkey" FOREIGN KEY ("commit_id") REFERENCES "commits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "achievement_evidence" ADD CONSTRAINT "achievement_evidence_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "pull_request_reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goals" ADD CONSTRAINT "goals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_achievements" ADD CONSTRAINT "goal_achievements_goal_id_fkey" FOREIGN KEY ("goal_id") REFERENCES "goals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_achievements" ADD CONSTRAINT "goal_achievements_achievement_id_fkey" FOREIGN KEY ("achievement_id") REFERENCES "achievements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "digest_deliveries" ADD CONSTRAINT "digest_deliveries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- AchievementEvidence: exactly one of pull_request_id, commit_id, review_id is set and matches `kind`.
ALTER TABLE "achievement_evidence" ADD CONSTRAINT "achievement_evidence_exactly_one_target" CHECK (
  (("pull_request_id" IS NOT NULL)::int + ("commit_id" IS NOT NULL)::int + ("review_id" IS NOT NULL)::int) = 1
  AND (
    ("kind" = 'PULL_REQUEST' AND "pull_request_id" IS NOT NULL) OR
    ("kind" = 'COMMIT' AND "commit_id" IS NOT NULL) OR
    ("kind" = 'REVIEW' AND "review_id" IS NOT NULL)
  )
);

-- Goal metric targets are all-or-nothing.
ALTER TABLE "goals" ADD CONSTRAINT "goals_metric_target_complete" CHECK (
  ("metric_key" IS NULL AND "comparator" IS NULL AND "target_value" IS NULL) OR
  ("metric_key" IS NOT NULL AND "comparator" IS NOT NULL AND "target_value" IS NOT NULL)
);
