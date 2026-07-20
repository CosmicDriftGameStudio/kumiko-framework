// --- Hook Phases ---
//
// inTransaction: Hook runs inside the DB transaction. Failures roll back
//   the entire write. Use for: DB-based side-effects (counter updates,
//   dependent entity writes).
//
// afterCommit (default): Hook runs after the transaction commits. Failures
//   are logged but don't affect the write. Use for: external systems
//   (SSE broadcast, search index, email, webhooks).

export const HookPhases = {
  inTransaction: "inTransaction",
  afterCommit: "afterCommit",
} as const;
