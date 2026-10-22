import type { createFallbackLogger } from "../logging/utils.ts";
import type { AfterCommitHook } from "./dispatcher-utils.ts";

export type AfterRollbackHook = () => Promise<void>;

// Side channel keyed by the afterCommit sink array, so executeWrite and friends keep their signatures.
// Invariant: every registration runs at most once, and only if the work it compensates was discarded.
const rollbackSinks = new WeakMap<AfterCommitHook[], AfterRollbackHook[]>();

export function afterRollbackHooksOf(commitSink: AfterCommitHook[]): AfterRollbackHook[] {
  const existing = rollbackSinks.get(commitSink);
  if (existing) return existing;
  const created: AfterRollbackHook[] = [];
  rollbackSinks.set(commitSink, created);
  return created;
}

// A rolled-back savepoint is not compensated immediately: the compensation could wait on locks of
// the still-open outer transaction. It runs once after that transaction ends, via the commit sink
// on commit or the rollback sink on rollback.
export function carrySavepointRollbackHooks(
  innerCommitSink: AfterCommitHook[],
  outerCommitSink: AfterCommitHook[],
  savepointRolledBack: boolean,
): void {
  const innerHooks = rollbackSinks.get(innerCommitSink) ?? [];
  if (innerHooks.length > 0) {
    if (savepointRolledBack) outerCommitSink.push(...innerHooks);
    afterRollbackHooksOf(outerCommitSink).push(...innerHooks);
  }
}

export async function flushAfterRollback(
  commitSink: AfterCommitHook[],
  logError: Pick<ReturnType<typeof createFallbackLogger>, "error">,
): Promise<void> {
  const hooks = rollbackSinks.get(commitSink) ?? [];
  const outcomes = await Promise.allSettled(hooks.map((hook) => hook()));
  for (const outcome of outcomes) {
    if (outcome.status === "rejected") {
      const detail =
        outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
      logError.error("afterRollback hook failed", { error: detail });
    }
  }
}
