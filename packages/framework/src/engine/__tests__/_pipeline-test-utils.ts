// Shared helpers for unit-tests of pipeline.ts / run-pipeline.ts and the
// step-builders. The minimal-ctx helper was 4 lines duplicated in every
// pipeline-* test file; centralised here for the M.1.6 cleanup-pass
// (Followup #7 splitting).
//
// Real-ctx integration lives in pipeline-handler.integration.ts —
// these helpers are deliberately for the no-DB tests where step-args
// + assembly + boot-time guards are what's exercised.

import type { HandlerContext } from "../types/handlers";

/**
 * Returns an empty object cast as HandlerContext. Steps that only
 * exercise their own arg-resolution + step-list-assembly don't read
 * any ctx field; the runner needs an object-shaped ctx but no surface
 * beyond that.
 *
 * Tests that actually use ctx fields (db, query, appendEvent, etc.)
 * belong in pipeline-handler.integration.ts against the real stack.
 */
export function buildMinimalCtx(): HandlerContext {
  return {} as HandlerContext;
}
