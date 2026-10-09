import { AsyncLocalStorage } from "node:async_hooks";
import type {
  EscapeHatchAuditSink,
  EscapeHatchKind,
  EscapeHatchReporter,
  EscapeHatchTarget,
  EscapeHatchUseEvent,
  TenantId,
} from "../engine/types/index.js";
import type { Logger } from "../logging/types.js";
import { createFallbackLogger } from "../logging/utils.js";
import { emitEscapeHatchUse } from "./standard-metrics.js";
import type { Meter } from "./types/index.js";

export const ESCAPE_HATCH_USED_SIGNAL = "security:escape-hatch-used";

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX_ENTRIES = 1_000;

export type EscapeHatchReportWindow = {
  shouldReport(key: string, nowMs: number): boolean;
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
    shouldReport(key, nowMs) {
      const expiresAt = entries.get(key);
      if (expiresAt !== undefined && expiresAt > nowMs) return false;
      entries.delete(key);
      entries.set(key, nowMs + windowMs);
      while (entries.size > maxEntries) {
        const oldestKey = entries.keys().next().value;
        if (oldestKey === undefined) break;
        entries.delete(oldestKey);
      }
      return true;
    },
  };
}

// Declared escape hatches of system crons are audited once per process and
// (handler, kind, tenant), never again: the declaration, the system actor and the
// reason are identical on every run, so repeats carry no information.
export type EscapeHatchProcessDedup = {
  readonly kinds: ReadonlySet<EscapeHatchKind>;
  readonly seen: Set<string>;
};

export function createEscapeHatchProcessDedup(
  kinds: readonly EscapeHatchKind[],
): EscapeHatchProcessDedup {
  return { kinds: new Set(kinds), seen: new Set() };
}

// Default window for createEscapeHatchReporter callers that don't pass their own.
const fallbackReportWindow = createEscapeHatchReportWindow();

type AuditPromises = Set<Promise<void>>;

// Sink writes that have started and not settled yet, process-wide: shutdown flushes them.
const processPendingAudits: AuditPromises = new Set();
// The sink writes of the dispatch or job run currently executing.
const scopePendingAudits = new AsyncLocalStorage<AuditPromises>();

function trackPendingAudit(write: Promise<void>): void {
  processPendingAudits.add(write);
  scopePendingAudits.getStore()?.add(write);
  void write.finally(() => processPendingAudits.delete(write));
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
      const processKey = JSON.stringify([opts.handler, kind, opts.tenantId]);
      // skip: this (handler, kind, tenant) was already audited by this process
      if (processDedup.seen.has(processKey)) return;
      processDedup.seen.add(processKey);
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
    // skip: same (handler, kind, reason, target) already reported within the window — dedup
    if (!window.shouldReport(key, now())) return;
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
