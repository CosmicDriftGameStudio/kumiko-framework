-- Migration 0011_form-draft-cleanup-expression-index
-- Hand-authored — not produced by `kumiko-schema generate`. The entity
-- `indexes` API (IndexMeta) only supports real-column indexes plus an
-- optional partial-index WHERE clause; it has no representation for an
-- expression index on COALESCE(modified_at, inserted_at). Added by hand per
-- the generator's own guidance (see any generated migration's header:
-- "add partial-indexes, BRIN-variants, performance-tuning"). Not tracked by
-- the declarative snapshot, so future `generate` runs neither recreate nor
-- drop it.
--
-- Backs db/queries/cleanup.ts's selectStaleDraftsBatch, which filters +
-- orders on this exact expression every nightly run — without it, the query
-- is a full seq-scan of read_form_drafts.
CREATE INDEX IF NOT EXISTS "read_form_drafts_cleanup_idx"
  ON "read_form_drafts" ((COALESCE("modified_at", "inserted_at")));
