-- P06-1 `repositories` (DATA_MODEL_V2 §5): one row per repository an integration touches.
-- Data step: one row per distinct (integration, repo) from commits ∪ pull_requests, plus the
-- reviewer-side repositories of cross-user v0.1 reviews (see P06-2), with
-- external_id = 'legacy:'||full_name and included = true. The first v2 sync matches these rows by
-- full_name and replaces external_id with the GitHub node id (P06-3).

CREATE TABLE "repositories" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "integration_id" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "owner_login" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_private" BOOLEAN NOT NULL DEFAULT false,
    "is_fork" BOOLEAN NOT NULL DEFAULT false,
    "is_archived" BOOLEAN NOT NULL DEFAULT false,
    "default_branch" TEXT,
    "html_url" TEXT,
    "installation_id" BIGINT,
    "accessible" BOOLEAN NOT NULL DEFAULT true,
    "included" BOOLEAN NOT NULL DEFAULT true,
    "inclusion_source" TEXT NOT NULL DEFAULT 'DEFAULT',
    "commit_cursor" TIMESTAMP(3),
    "last_activity_at" TIMESTAMP(3),
    "last_synced_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "repositories_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "repositories_user_id_included_idx" ON "repositories"("user_id", "included");
CREATE UNIQUE INDEX "repositories_integration_id_external_id_key" ON "repositories"("integration_id", "external_id");
CREATE UNIQUE INDEX "repositories_integration_id_full_name_key" ON "repositories"("integration_id", "full_name");

ALTER TABLE "repositories" ADD CONSTRAINT "repositories_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "repositories" ADD CONSTRAINT "repositories_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Ids are cuid-shaped ('c' + 24 lowercase hex chars) so they pass the API's Id schema.
WITH legacy AS (
    SELECT c."integrationId" AS integration_id, c."repo" AS full_name, MAX(c."timestamp") AS last_at
    FROM "commits" c GROUP BY 1, 2
    UNION ALL
    SELECT p."integrationId", p."repo", MAX(p."timestamp") FROM "pull_requests" p GROUP BY 1, 2
    UNION ALL
    -- Reviews stored on another user's PR row (P02 demo seed): the reviewer gets the repository
    -- under their own most recent GitHub integration.
    SELECT ri.id, p."repo", MAX(cr."timestamp")
    FROM "code_reviews" cr
    JOIN "pull_requests" p ON p.id = cr."prId" AND p."userId" <> cr."userId"
    JOIN LATERAL (
        SELECT i.id FROM "integrations" i
        WHERE i."userId" = cr."userId" AND i.provider = 'GITHUB'
        ORDER BY i."updatedAt" DESC LIMIT 1
    ) ri ON true
    GROUP BY 1, 2
),
merged AS (
    SELECT integration_id, full_name, MAX(last_at) AS last_at FROM legacy GROUP BY 1, 2
)
INSERT INTO "repositories" ("id", "user_id", "integration_id", "external_id", "full_name", "owner_login", "name", "included", "last_activity_at", "updated_at")
SELECT
    'c' || substr(md5(m.integration_id || ':' || m.full_name || ':' || random()::text), 1, 24),
    i."userId",
    m.integration_id,
    'legacy:' || m.full_name,
    m.full_name,
    split_part(m.full_name, '/', 1),
    COALESCE(NULLIF(split_part(m.full_name, '/', 2), ''), m.full_name),
    true,
    m.last_at,
    CURRENT_TIMESTAMP
FROM merged m
JOIN "integrations" i ON i.id = m.integration_id;

-- Prisma manages updated_at in the client (@updatedAt); the default only served the backfill.
ALTER TABLE "repositories" ALTER COLUMN "updated_at" DROP DEFAULT;
