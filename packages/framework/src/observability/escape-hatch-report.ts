import { AsyncLocalStorage } from "node:async_hooks";
import type {
  EscapeHatchAuditSink,
  EscapeHatchKind,
  EscapeHatchReporter,
  EscapeHatchTarget,
  EscapeHatchUseEvent,
  TenantId,
} from "../engine/types/index.ts";
import type { Logger } from "../logging/types.ts";
import { createFallbackLogger } from "../logging/utils.ts";
import { emitEscapeHatchUse } from "./standard-metrics.ts";
import type { Meter } from "./types/index.ts";

export const ESCAPE_HATCH_USED_SIGNAL = "security:escape-hatch-used";

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX_ENTRIES = 1_000;

export type EscapeHatchReportWindow = {
  shouldReport(key: string, nowMs: number, windowMs?: number): boolean;
};

// Dedups identical (handler,kind,reason,tenant,actor,target) reports within the window so hot systemScope queries don't write one row per request.
export function createEscapeHatchReportWindow(opts?: {
  readonly windowMs?: number;
  readonly maxEntries?: number;
}): EscapeHatchReportWindow {
  const windowMs = opts?.windowMs ?? DEFAULT_WINDOW_MS;
  const maxEntries = opts?.maxEntries ?? DEFAULT_MAX_ENTRIES;
  // Map insertion order doubles as recency order: a re-set moves the key to the end.
  const entries = new Map<string, number>();

  return {
    shouldReport(key, nowMs, keyWindowMs = windowMs) {
      const expiresAt = entries.get(key);
      if (expiresAt !== undefined && expiresAt > nowMs) return false;
      entries.delete(key);
      entries.set(key, nowMs + keyWindowMs);
      while (entries.size > maxEntries) {
        const oldestKey = entries.keys().next().value;
        if (oldestKey === undefined) break;
        entries.delete(oldestKey);
      }
      return true;
    },
  };
}

// Cross-tenant reads without a target (every reference lookup of a SystemAdmin list is one)
// repeat on each page load. One event per actor and hour keeps the trace that a SystemAdmin read
// other tenants without flooding the audit view; the in-memory window means one event per
// instance with several instances, which is acceptable. Writes, identity switches and anything
// aimed at a target keep the short window.
const READ_WINDOW_MS = 60 * 60 * 1000;
const READ_WINDOW_KINDS: ReadonlySet<EscapeHatchKind> = new Set([
  "acknowledge-cross-tenant",
  "cross-tenant-read",
]);

// A long-lived worker must leave an audit event inside every retention window
// (90 days), or its crons vanish from the log once the first event is pruned.
const PROCESS_REAUDIT_INTERVAL_MS = 24 * 60 * 60 * 1000;

// Declared escape hatches of system crons are audited once per day and process for each
// (handler, kind, tenant, target): the declaration, the system actor and the reason are
// identical on every run, so repeats carry no information. The target is part of the
// key only where it names a table (one run can write several global tables); a row target
// would add a key and an audit event per touched foreign row.
const TABLE_TARGET_KINDS: ReadonlySet<EscapeHatchKind> = new Set(["global-write"]);

export type EscapeHatchProcessDedup = {
  readonly kinds: ReadonlySet<EscapeHatchKind>;
  readonly lastAuditedAt: Map<string, number>;
  readonly lastSweep: { atMs: number };
};

// Row-level targets add a key per touched row; without a sweep a long-lived worker keeps them all.
function sweepExpiredProcessDedup(dedup: EscapeHatchProcessDedup, nowMs: number): void {
  if (nowMs - dedup.lastSweep.atMs >= PROCESS_REAUDIT_INTERVAL_MS) {
    dedup.lastSweep.atMs = nowMs;
    for (const [key, auditedAt] of dedup.lastAuditedAt) {
      if (nowMs - auditedAt >= PROCESS_REAUDIT_INTERVAL_MS) dedup.lastAuditedAt.delete(key);
    }
  }
}

export function createEscapeHatchProcessDedup(
  kinds: readonly EscapeHatchKind[],
): EscapeHatchProcessDedup {
  return { kinds: new Set(kinds), lastAuditedAt: new Map(), lastSweep: { atMs: 0 } };
}

// Default window for createEscapeHatchReporter callers that don't pass their own.
const fallbackReportWindow = createEscapeHatchReportWindow();

type AuditPromises = Set<Promise<void>>;

// Sink writes that have started and not settled yet, process-wide: shutdown flushes them.
const processPendingAudits: AuditPromises = new Set();
// The sink writes of the dispatch or job run currently executing.
const scopePendingAudits = new AsyncLocalStorage<AuditPromises>();

function trackPendingAudit(write: Promise<void>): void {
  const scope = scopePendingAudits.getStore();
  processPendingAudits.add(write);
  scope?.add(write);
  // Settled writes leave the scope so a long-lived stream does not accumulate them.
  void write.finally(() => {
    processPendingAudits.delete(write);
    scope?.delete(write);
  });
}

// Awaits the audit writes started inside `run` once it has returned, so callers place it around
// the transaction and the write is durable when the dispatch or run ends. Nested scopes belong
// to the outermost one (a nested dispatch runs inside its caller's transaction, which must not
// wait on the sink). Sink failures are already logged by reportEscapeHatchUse and never throw here.
export async function withEscapeHatchAuditScope<T>(run: () => Promise<T>): Promise<T> {
  if (scopePendingAudits.getStore() !== undefined) return run();
  const pending: AuditPromises = new Set();
  try {
    return await scopePendingAudits.run(pending, run);
  } finally {
    await Promise.allSettled([...pending]);
  }
}

// Stream variant: the scope has to be entered on every pull because an async generator body
// runs in the caller's async context, and the wait happens once the stream ends or is closed.
export async function* withEscapeHatchAuditScopeStream<T>(
  run: () => AsyncGenerator<T>,
): AsyncGenerator<T> {
  if (scopePendingAudits.getStore() !== undefined) {
    yield* run();
    // skip: an enclosing scope already waits for the pending audits
    return;
  }
  const pending: AuditPromises = new Set();
  const source = run();
  try {
    while (true) {
      const next = await scopePendingAudits.run(pending, () => source.next());
      // skip: the source is exhausted
      if (next.done) return;
      yield next.value;
    }
  } finally {
    await scopePendingAudits.run(pending, () => source.return(undefined));
    await Promise.allSettled([...pending]);
  }
}

export async function flushEscapeHatchAudits(): Promise<void> {
  while (processPendingAudits.size > 0) {
    await Promise.allSettled([...processPendingAudits]);
  }
}

function eventFields(event: EscapeHatchUseEvent): Record<string, unknown> {
  return {
    handler: event.handler,
    kind: event.kind,
    reason: event.reason,
    tenantId: event.tenantId,
    actor: event.actor,
    ...(event.caller !== undefined && { caller: event.caller }),
    ...(event.target && { targetId: event.target.id, targetTenantId: event.target.tenantId }),
  };
}

export function reportEscapeHatchUse(
  event: EscapeHatchUseEvent,
  deps: {
    readonly sink?: EscapeHatchAuditSink;
    readonly log: Pick<Logger, "warn" | "error">;
  },
): void {
  const fields = eventFields(event);
  if (deps.sink) {
    const write = deps.sink(event).catch((err: unknown) => {
      deps.log.error(`${ESCAPE_HATCH_USED_SIGNAL}: audit sink failed`, {
        ...fields,
        error: err instanceof Error ? err.message : String(err),
      });
    });
    trackPendingAudit(write);
  } else {
    deps.log.warn(ESCAPE_HATCH_USED_SIGNAL, fields);
  }
}

export function createEscapeHatchReporter(opts: {
  readonly handler: string;
  readonly tenantId: TenantId;
  readonly actor: string;
  // Initiating identity when it differs from `actor` (a job run triggered by a user).
  readonly caller?: string | undefined;
  readonly sink?: EscapeHatchAuditSink;
  readonly log: Pick<Logger, "warn" | "error">;
  readonly window?: EscapeHatchReportWindow;
  readonly processDedup?: EscapeHatchProcessDedup;
  readonly meter?: Meter;
  readonly now?: () => number;
}): EscapeHatchReporter {
  const window = opts.window ?? fallbackReportWindow;
  const now = opts.now ?? Date.now;
  const deps = { sink: opts.sink, log: opts.log };
  const eventFor = (
    kind: EscapeHatchKind,
    reason: string,
    target: EscapeHatchTarget | undefined,
  ): EscapeHatchUseEvent => ({
    handler: opts.handler,
    kind,
    reason,
    tenantId: opts.tenantId,
    actor: opts.actor,
    ...(opts.caller !== undefined && { caller: opts.caller }),
    target,
  });

  return (kind: EscapeHatchKind, reason: string, target?: EscapeHatchTarget) => {
    if (opts.meter) emitEscapeHatchUse(opts.meter, opts.handler, kind);
    const { processDedup } = opts;
    if (processDedup?.kinds.has(kind)) {
      const keyTarget = TABLE_TARGET_KINDS.has(kind) ? target : undefined;
      const processKey = JSON.stringify([
        opts.handler,
        kind,
        opts.tenantId,
        keyTarget?.id ?? null,
        keyTarget?.tenantId ?? null,
      ]);
      const nowMs = now();
      const lastAuditedAt = processDedup.lastAuditedAt.get(processKey);
      // skip: audited by this process within the re-audit interval
      if (lastAuditedAt !== undefined && nowMs - lastAuditedAt < PROCESS_REAUDIT_INTERVAL_MS) {
        return;
      }
      sweepExpiredProcessDedup(processDedup, nowMs);
      processDedup.lastAuditedAt.set(processKey, nowMs);
      reportEscapeHatchUse(eventFor(kind, reason, target), deps);
      // skip: audited above, the window dedup below only serves the other kinds
      return;
    }
    const key = JSON.stringify([
      opts.handler,
      kind,
      reason,
      opts.tenantId,
      opts.actor,
      opts.caller ?? null,
      target?.id ?? null,
      target?.tenantId ?? null,
    ]);
    const isTargetlessRead = READ_WINDOW_KINDS.has(kind) && target === undefined;
    // skip: same (handler, kind, reason, target) already reported within the window — dedup
    if (!window.shouldReport(key, now(), isTargetlessRead ? READ_WINDOW_MS : undefined)) return;
    reportEscapeHatchUse(eventFor(kind, reason, target), deps);
  };
}

// Actor for escape-hatch uses whose caller did not thread one through. Stays
// "system" so audit events persisted before the constant existed remain valid.
export const UNATTRIBUTED_ACTOR = "system";

export function fallbackEscapeHatchReporter(tenantId: TenantId): EscapeHatchReporter {
  return createEscapeHatchReporter({
    handler: "<unattributed>",
    tenantId,
    actor: "<unattributed>",
    log: createFallbackLogger("escape-hatch"),
  });
}
