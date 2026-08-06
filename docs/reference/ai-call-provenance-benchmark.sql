-- Storage and query cost benchmark for AI-call provenance events in the
-- kumiko_events table (Kumiko's event-sourced store).
--
-- Measures three things: bytes per payload, total relation size including
-- indexes, and query latency for a tenant-scoped lookup plus a global
-- promptVersion lookup (before/after an expression index). The payload
-- shape (field names/types) matches what a real ai-call provenance event
-- carries: provider/model identifiers, prompt/input hashes, latency, token
-- usage, and reported cost.
--
-- Self-contained and destructive: creates its own `kumiko_events` table,
-- drops it first if present, seeds it, and measures against it. Do NOT run
-- this against a real database — only a throwaway one:
--   psql -v rows=100000 -v prompt_versions=8 -f ai-call-provenance-benchmark.sql
--
-- Row count and promptVersion cardinality are REQUIRED as psql variables:
-- prompt_versions controls how many distinct promptVersion hash buckets
-- exist (a real deployment gets one new bucket per prompt-assembly change,
-- so cardinality grows with prompt iteration count, not with row count —
-- worth sweeping independently of :rows to see when Postgres's planner
-- switches from a seq scan to using the expression index created below).
-- (no defaults — a missing -v makes every :rows/:prompt_versions reference
-- fail loudly instead of silently seeding the wrong shape)

\timing on

-- =============================================================================
-- 1. Schema — same shape as kumiko_events (events-schema.ts), only the
--    columns the benchmark touches. No FKs/other tables exist in the real
--    store either; kumiko_events is genuinely this flat.
-- =============================================================================

DROP TABLE IF EXISTS kumiko_events;

CREATE TABLE kumiko_events (
  id bigserial PRIMARY KEY,
  aggregate_id uuid NOT NULL,
  aggregate_type text NOT NULL,
  tenant_id uuid NOT NULL,
  version integer NOT NULL,
  type text NOT NULL,
  event_version integer NOT NULL DEFAULT 1,
  payload jsonb NOT NULL,
  metadata jsonb NOT NULL,
  created_at timestamp(3) NOT NULL DEFAULT now(),
  created_by text NOT NULL
);

CREATE UNIQUE INDEX events_aggregate_version_uq ON kumiko_events (tenant_id, aggregate_id, version);
CREATE INDEX events_load_idx ON kumiko_events (aggregate_id, version);
CREATE INDEX events_tenant_type_idx ON kumiko_events (tenant_id, aggregate_type, created_at);

-- =============================================================================
-- 2. Seed — one row per ai-call. Payload keys match a successful chat
--    completion call (the common case; failed calls carry an error kind
--    and HTTP status instead).
--    Spread: :prompt_versions promptVersion buckets (12-hex-char sha256
--    slices in reality; here just deterministic hex strings of the same
--    length), 5 tenants, created_at spread across a 90-day window,
--    latency/usage/cost varying per row so payload byte size isn't
--    artificially uniform.
-- =============================================================================

INSERT INTO kumiko_events (
  aggregate_id, aggregate_type, tenant_id, version, type, event_version,
  payload, metadata, created_at, created_by
)
SELECT
  gen_random_uuid() AS aggregate_id,
  'ai-call' AS aggregate_type,
  ('00000000-0000-0000-0000-' || lpad((1 + (g % 5))::text, 12, '0'))::uuid AS tenant_id,
  1 AS version,
  'ai-foundation:ai-call-recorded' AS type,
  1 AS event_version,
  jsonb_build_object(
    'providerId', (ARRAY['anthropic', 'openai', 'mock'])[1 + (g % 3)],
    'handlerName', (ARRAY['ai-extract:run', 'ai-patch:suggest', 'ai-chat:reply'])[1 + (g % 3)],
    'runId', gen_random_uuid()::text,
    'requestedModel', (ARRAY['claude-sonnet-5', 'claude-opus-5', 'gpt-5.1'])[1 + (g % 3)],
    -- promptVersion/inputHash lengths match hashPromptVersion()/hashInput()
    -- in provenance.ts exactly: sha256 hex slice(0,12) and slice(0,16).
    'promptVersion', left(md5(('pv-' || (g % :prompt_versions))::text), 12),
    'inputHash', left(md5(('input-' || g)::text), 16),
    'latencyMs', 200 + (g % 4000),
    'respondedModel', (ARRAY['claude-sonnet-5-20260514', 'claude-opus-5-20260514', 'gpt-5.1-2026-06-01'])[1 + (g % 3)],
    'respondedProvider', (ARRAY['anthropic', 'anthropic', 'openai'])[1 + (g % 3)],
    'providerCallId', 'req_' || md5(g::text),
    'usage', jsonb_build_object(
      'inputTokens', 200 + (g % 8000),
      'outputTokens', 20 + (g % 2000)
    ),
    'reportedCostUsd', round((0.0005 + (g % 500) * 0.0003)::numeric, 6),
    'stopReason', (ARRAY['end_turn', 'tool_use', 'max_tokens'])[1 + (g % 3)]
  ) AS payload,
  jsonb_build_object(
    'userId', 'user-' || (g % 50),
    'requestId', gen_random_uuid()::text,
    'correlationId', gen_random_uuid()::text
  ) AS metadata,
  (now() - (random() * interval '90 days'))::timestamp(3) AS created_at,
  'user-' || (g % 50) AS created_by
FROM generate_series(1, :rows) AS g;

ANALYZE kumiko_events;

-- =============================================================================
-- 3. Storage measurements
-- =============================================================================

\echo '--- payload bytes per event (median / p95) ---'
SELECT
  count(*) AS rows,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY pg_column_size(payload)) AS median_payload_bytes,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY pg_column_size(payload)) AS p95_payload_bytes,
  round(avg(pg_column_size(payload))) AS avg_payload_bytes
FROM kumiko_events;

\echo '--- total relation size (table + indexes + toast) ---'
SELECT
  pg_size_pretty(pg_total_relation_size('kumiko_events')) AS total_size_pretty,
  pg_total_relation_size('kumiko_events') AS total_size_bytes,
  (SELECT count(*) FROM kumiko_events) AS rows,
  round(pg_total_relation_size('kumiko_events')::numeric / NULLIF((SELECT count(*) FROM kumiko_events), 0), 2) AS bytes_per_row_incl_indexes;

\echo '--- projection: MB/month at 10k ai-calls/day, using this bytes/row ---'
SELECT
  round(
    (pg_total_relation_size('kumiko_events')::numeric / NULLIF((SELECT count(*) FROM kumiko_events), 0))
    * 10000 * 30 / 1024.0 / 1024.0,
    2
  ) AS projected_mb_per_month;

-- =============================================================================
-- 4. Query A — tenant-scoped lookup as the event-store actually indexes it
--    (events_tenant_type_idx covers tenant_id, aggregate_type, created_at;
--    the promptVersion filter on the jsonb payload is NOT part of that
--    index, so it's a recheck filter on the index-selected rows).
-- =============================================================================

\echo '--- Query A: tenant + aggregate_type + created_at range + promptVersion filter (5 runs, warm cache) ---'

-- warm the cache once, discard the output
SELECT count(*) FROM kumiko_events
WHERE tenant_id = '00000000-0000-0000-0000-000000000001'
  AND aggregate_type = 'ai-call'
  AND created_at BETWEEN now() - interval '30 days' AND now()
  AND payload->>'promptVersion' = left(md5('pv-0'), 12);

EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT * FROM kumiko_events
WHERE tenant_id = '00000000-0000-0000-0000-000000000001'
  AND aggregate_type = 'ai-call'
  AND created_at BETWEEN now() - interval '30 days' AND now()
  AND payload->>'promptVersion' = left(md5('pv-0'), 12);

EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT * FROM kumiko_events
WHERE tenant_id = '00000000-0000-0000-0000-000000000001'
  AND aggregate_type = 'ai-call'
  AND created_at BETWEEN now() - interval '30 days' AND now()
  AND payload->>'promptVersion' = left(md5('pv-0'), 12);

EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT * FROM kumiko_events
WHERE tenant_id = '00000000-0000-0000-0000-000000000001'
  AND aggregate_type = 'ai-call'
  AND created_at BETWEEN now() - interval '30 days' AND now()
  AND payload->>'promptVersion' = left(md5('pv-0'), 12);

EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT * FROM kumiko_events
WHERE tenant_id = '00000000-0000-0000-0000-000000000001'
  AND aggregate_type = 'ai-call'
  AND created_at BETWEEN now() - interval '30 days' AND now()
  AND payload->>'promptVersion' = left(md5('pv-0'), 12);

EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT * FROM kumiko_events
WHERE tenant_id = '00000000-0000-0000-0000-000000000001'
  AND aggregate_type = 'ai-call'
  AND created_at BETWEEN now() - interval '30 days' AND now()
  AND payload->>'promptVersion' = left(md5('pv-0'), 12);

-- =============================================================================
-- 5. Query B — global promptVersion lookup across all tenants, before and
--    after an expression index on payload->>'promptVersion'.
-- =============================================================================

\echo '--- Query B (no expression index), 5 runs, warm cache ---'

SELECT count(*) FROM kumiko_events WHERE payload->>'promptVersion' = left(md5('pv-0'), 12);

EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT * FROM kumiko_events WHERE payload->>'promptVersion' = left(md5('pv-0'), 12);

EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT * FROM kumiko_events WHERE payload->>'promptVersion' = left(md5('pv-0'), 12);

EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT * FROM kumiko_events WHERE payload->>'promptVersion' = left(md5('pv-0'), 12);

EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT * FROM kumiko_events WHERE payload->>'promptVersion' = left(md5('pv-0'), 12);

EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT * FROM kumiko_events WHERE payload->>'promptVersion' = left(md5('pv-0'), 12);

\echo '--- creating expression index on payload->>promptVersion ---'
CREATE INDEX events_payload_prompt_version_idx ON kumiko_events ((payload->>'promptVersion'));
ANALYZE kumiko_events;

\echo '--- expression index size ---'
SELECT pg_size_pretty(pg_relation_size('events_payload_prompt_version_idx')) AS index_size_pretty,
       pg_relation_size('events_payload_prompt_version_idx') AS index_size_bytes;

\echo '--- Query B (with expression index), 5 runs, warm cache ---'

SELECT count(*) FROM kumiko_events WHERE payload->>'promptVersion' = left(md5('pv-0'), 12);

EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT * FROM kumiko_events WHERE payload->>'promptVersion' = left(md5('pv-0'), 12);

EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT * FROM kumiko_events WHERE payload->>'promptVersion' = left(md5('pv-0'), 12);

EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT * FROM kumiko_events WHERE payload->>'promptVersion' = left(md5('pv-0'), 12);

EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT * FROM kumiko_events WHERE payload->>'promptVersion' = left(md5('pv-0'), 12);

EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT * FROM kumiko_events WHERE payload->>'promptVersion' = left(md5('pv-0'), 12);

\timing off
