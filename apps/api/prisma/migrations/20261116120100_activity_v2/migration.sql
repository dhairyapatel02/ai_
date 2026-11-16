-- P06-2 `activity_v2` (DATA_MODEL_V2 §5): commits/pull_requests v2 columns, explicit authorship,
-- reviews decoupled from PR authorship, sync runs and webhook deliveries.
-- Data steps (DATA-01, DATA-08, DATA-10):
--   commits: message_headline/body from message, authored_at = timestamp, repository_id via full name.
--   pull_requests: repository_id via full name, created_at_remote = timestamp; v0.1 "PR #n" stubs
--     (reviewed-only PRs stored as the user's own) become legacy_stub and stop counting as authored.
--   code_reviews -> pull_request_reviews (external_id 'legacy:'||id). A review stored on another
--     user's PR row (P02 demo seed) gets a reviewer-owned copy of that PR (is_authored_by_user=false).
-- Forward-only: take a pg_dump before running in production (DATA_MODEL_V2 §5 rollback strategy).

-- ───── Enums ─────
CREATE TYPE "ReviewState" AS ENUM ('APPROVED', 'CHANGES_REQUESTED', 'COMMENTED', 'DISMISSED');
CREATE TYPE "SyncTrigger" AS ENUM ('INITIAL', 'MANUAL', 'SCHEDULED', 'WEBHOOK', 'RECONNECT');
CREATE TYPE "SyncKind" AS ENUM ('BACKFILL', 'INCREMENTAL', 'TARGETED');
CREATE TYPE "SyncStatus" AS ENUM ('QUEUED', 'RUNNING', 'WAITING_RATE_LIMIT', 'SUCCEEDED', 'PARTIAL', 'FAILED', 'CANCELLED');
CREATE TYPE "SyncStage" AS ENUM ('PREPARE', 'REPOSITORIES', 'AUTHORED_PRS', 'REVIEWED_PRS', 'COMMITS', 'PERSIST', 'ROLLUPS', 'DONE');
CREATE TYPE "WebhookStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED');

-- ───── Commits ─────
ALTER TABLE "commits"
ADD COLUMN "repository_id" TEXT,
ADD COLUMN "message_headline" TEXT,
ADD COLUMN "message_body" TEXT,
ADD COLUMN "authored_at" TIMESTAMP(3),
ADD COLUMN "committed_at" TIMESTAMP(3),
ADD COLUMN "changed_files" INTEGER,
ADD COLUMN "parents_count" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "associated_pr_number" INTEGER,
ADD COLUMN "author_external_id" TEXT,
ADD COLUMN "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "commits" c SET
    "repository_id" = r.id,
    "message_headline" = split_part(c."message", E'\n', 1),
    "message_body" = NULLIF(btrim(substr(c."message", length(split_part(c."message", E'\n', 1)) + 2)), ''),
    "authored_at" = c."timestamp"
FROM "repositories" r
WHERE r."integration_id" = c."integrationId" AND r."full_name" = c."repo";

ALTER TABLE "commits"
ALTER COLUMN "repository_id" SET NOT NULL,
ALTER COLUMN "message_headline" SET NOT NULL,
ALTER COLUMN "authored_at" SET NOT NULL;

DROP INDEX "commits_userId_timestamp_idx";
ALTER TABLE "commits" DROP COLUMN "message", DROP COLUMN "repo", DROP COLUMN "timestamp";
CREATE INDEX "commits_userId_authored_at_idx" ON "commits"("userId", "authored_at");
CREATE INDEX "commits_repository_id_authored_at_idx" ON "commits"("repository_id", "authored_at");
ALTER TABLE "commits" ADD CONSTRAINT "commits_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ───── Pull requests ─────
ALTER TABLE "pull_requests" RENAME COLUMN "timestamp" TO "created_at_remote";
ALTER TABLE "pull_requests"
ADD COLUMN "repository_id" TEXT,
ADD COLUMN "external_id" TEXT,
ADD COLUMN "url" TEXT,
ADD COLUMN "is_draft" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "is_authored_by_user" BOOLEAN,
ADD COLUMN "author_external_id" TEXT,
ADD COLUMN "author_login" TEXT,
ADD COLUMN "labels" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "base_ref" TEXT,
ADD COLUMN "ready_for_review_at" TIMESTAMP(3),
ADD COLUMN "closed_at" TIMESTAMP(3),
ADD COLUMN "updated_at_remote" TIMESTAMP(3),
ADD COLUMN "additions" INTEGER,
ADD COLUMN "deletions" INTEGER,
ADD COLUMN "changed_files" INTEGER,
ADD COLUMN "commits_count" INTEGER,
ADD COLUMN "first_review_at" TIMESTAMP(3),
ADD COLUMN "reviewers_count" INTEGER,
ADD COLUMN "approvals_count" INTEGER,
ADD COLUMN "changes_requested_count" INTEGER,
ADD COLUMN "is_revert" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "reverted_at" TIMESTAMP(3),
ADD COLUMN "reverted_by_url" TEXT,
ADD COLUMN "legacy_stub" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "pull_requests" p SET "repository_id" = r.id
FROM "repositories" r
WHERE r."integration_id" = p."integrationId" AND r."full_name" = p."repo";

-- v0.1 stubs (sync.processor.ts created "PR #n", CLOSED rows for reviewed-only PRs). The v0.1
-- sync left the body empty; the P01 audit fixture adds a marker body, so the body test of the
-- blueprint is replaced by the stricter "title is exactly 'PR #<own number>' and never merged" (D-022).
UPDATE "pull_requests" p SET "legacy_stub" = true
WHERE p."title" ~ '^PR #[0-9]+$'
  AND p."title" = 'PR #' || p."number"
  AND p."state" = 'CLOSED'
  AND p."mergedAt" IS NULL
  AND EXISTS (SELECT 1 FROM "code_reviews" cr WHERE cr."prId" = p.id AND cr."userId" = p."userId");

UPDATE "pull_requests" SET
    "is_authored_by_user" = NOT "legacy_stub",
    "body" = CASE WHEN "legacy_stub" THEN NULL ELSE "body" END,
    "closed_at" = CASE WHEN "state" = 'MERGED' THEN "mergedAt" ELSE NULL END;

ALTER TABLE "pull_requests"
ALTER COLUMN "repository_id" SET NOT NULL,
ALTER COLUMN "is_authored_by_user" SET NOT NULL;

DROP INDEX "pull_requests_userId_repo_number_key";
DROP INDEX "pull_requests_userId_timestamp_idx";
CREATE UNIQUE INDEX "pull_requests_userId_repository_id_number_key" ON "pull_requests"("userId", "repository_id", "number");
CREATE UNIQUE INDEX "pull_requests_userId_external_id_key" ON "pull_requests"("userId", "external_id");
CREATE INDEX "pull_requests_userId_is_authored_by_user_mergedAt_idx" ON "pull_requests"("userId", "is_authored_by_user", "mergedAt");
CREATE INDEX "pull_requests_userId_is_authored_by_user_created_at_remote_idx" ON "pull_requests"("userId", "is_authored_by_user", "created_at_remote");
CREATE INDEX "pull_requests_userId_is_authored_by_user_closed_at_idx" ON "pull_requests"("userId", "is_authored_by_user", "closed_at");
CREATE INDEX "pull_requests_userId_first_review_at_idx" ON "pull_requests"("userId", "first_review_at");
ALTER TABLE "pull_requests" ADD CONSTRAINT "pull_requests_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Reviewer-owned copies of other users' PRs that carry a v0.1 review (metadata only, no body).
INSERT INTO "pull_requests" ("id", "userId", "integrationId", "repository_id", "repo", "number", "title", "state", "mergedAt", "created_at_remote", "closed_at", "is_authored_by_user", "author_login")
SELECT DISTINCT ON (cr."userId", r.id, p."number")
    'c' || substr(md5(cr."userId" || ':' || p.id || ':' || random()::text), 1, 24),
    cr."userId", r."integration_id", r.id, p."repo", p."number", p."title", p."state", p."mergedAt",
    p."created_at_remote", CASE WHEN p."state" = 'MERGED' THEN p."mergedAt" ELSE NULL END,
    false, oi."external_login"
FROM "code_reviews" cr
JOIN "pull_requests" p ON p.id = cr."prId" AND p."userId" <> cr."userId"
JOIN "repositories" pr_repo ON pr_repo.id = p."repository_id"
JOIN "integrations" oi ON oi.id = p."integrationId"
JOIN LATERAL (
    SELECT i.id FROM "integrations" i
    WHERE i."userId" = cr."userId" AND i.provider = 'GITHUB'
    ORDER BY i."updatedAt" DESC LIMIT 1
) ri ON true
JOIN "repositories" r ON r."integration_id" = ri.id AND r."full_name" = pr_repo."full_name"
ON CONFLICT ("userId", "repository_id", "number") DO NOTHING;

-- ───── Reviews ─────
CREATE TABLE "pull_request_reviews" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "integration_id" TEXT NOT NULL,
    "pull_request_id" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "state" "ReviewState" NOT NULL,
    "submitted_at" TIMESTAMP(3) NOT NULL,
    "has_body" BOOLEAN NOT NULL DEFAULT false,
    "comments_count" INTEGER NOT NULL DEFAULT 0,
    "review_requested_at" TIMESTAMP(3),
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pull_request_reviews_pkey" PRIMARY KEY ("id")
);

INSERT INTO "pull_request_reviews" ("id", "user_id", "integration_id", "pull_request_id", "external_id", "state", "submitted_at", "has_body", "comments_count")
SELECT
    cr.id, cr."userId", target."integrationId", target.id, 'legacy:' || cr.id,
    (CASE WHEN cr."approved" THEN 'APPROVED' ELSE 'COMMENTED' END)::"ReviewState",
    cr."timestamp", cr."comments" > 0, 0
FROM "code_reviews" cr
JOIN "pull_requests" p ON p.id = cr."prId"
JOIN "repositories" pr_repo ON pr_repo.id = p."repository_id"
JOIN LATERAL (
    SELECT t.id, t."integrationId" FROM "pull_requests" t
    JOIN "repositories" tr ON tr.id = t."repository_id"
    WHERE t."userId" = cr."userId" AND tr."full_name" = pr_repo."full_name" AND t."number" = p."number"
    ORDER BY (t.id = p.id) DESC
    LIMIT 1
) target ON true;

CREATE INDEX "pull_request_reviews_user_id_submitted_at_idx" ON "pull_request_reviews"("user_id", "submitted_at");
CREATE INDEX "pull_request_reviews_pull_request_id_idx" ON "pull_request_reviews"("pull_request_id");
CREATE UNIQUE INDEX "pull_request_reviews_user_id_external_id_key" ON "pull_request_reviews"("user_id", "external_id");
ALTER TABLE "pull_request_reviews" ADD CONSTRAINT "pull_request_reviews_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pull_request_reviews" ADD CONSTRAINT "pull_request_reviews_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pull_request_reviews" ADD CONSTRAINT "pull_request_reviews_pull_request_id_fkey" FOREIGN KEY ("pull_request_id") REFERENCES "pull_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ───── Drops (after the copies above) ─────
ALTER TABLE "code_reviews" DROP CONSTRAINT "code_reviews_prId_fkey";
ALTER TABLE "code_reviews" DROP CONSTRAINT "code_reviews_userId_fkey";
DROP TABLE "code_reviews";
ALTER TABLE "pull_requests" DROP COLUMN "repo", DROP COLUMN "reviewCount";

-- ───── Sync runs ─────
CREATE TABLE "sync_runs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "integration_id" TEXT NOT NULL,
    "trigger" "SyncTrigger" NOT NULL,
    "kind" "SyncKind" NOT NULL,
    "status" "SyncStatus" NOT NULL DEFAULT 'QUEUED',
    "stage" "SyncStage" NOT NULL DEFAULT 'PREPARE',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "window_from" TIMESTAMP(3),
    "window_to" TIMESTAMP(3),
    "counts" JSONB NOT NULL DEFAULT '{}',
    "api_calls" INTEGER NOT NULL DEFAULT 0,
    "rate_limit_remaining" INTEGER,
    "resume_at" TIMESTAMP(3),
    "checkpoint" JSONB NOT NULL DEFAULT '{}',
    "recent_window_completed_at" TIMESTAMP(3),
    "error_code" TEXT,
    "error_message" TEXT,
    "errors" JSONB NOT NULL DEFAULT '[]',
    "job_id" TEXT,
    "webhook_delivery_id" TEXT,
    "queued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "sync_runs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "sync_runs_integration_id_queued_at_idx" ON "sync_runs"("integration_id", "queued_at" DESC);
CREATE INDEX "sync_runs_user_id_queued_at_idx" ON "sync_runs"("user_id", "queued_at" DESC);
CREATE INDEX "sync_runs_status_idx" ON "sync_runs"("status");
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ───── Webhook deliveries (global; idempotency via X-GitHub-Delivery) ─────
CREATE TABLE "webhook_deliveries" (
    "id" TEXT NOT NULL,
    "provider" "Provider" NOT NULL,
    "event" TEXT NOT NULL,
    "action" TEXT,
    "installation_id" BIGINT,
    "status" "WebhookStatus" NOT NULL DEFAULT 'RECEIVED',
    "error" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "webhook_deliveries_received_at_idx" ON "webhook_deliveries"("received_at");
