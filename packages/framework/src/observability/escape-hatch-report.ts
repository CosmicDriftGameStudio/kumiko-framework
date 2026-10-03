import type {
  EscapeHatchAuditSink,
  EscapeHatchKind,
  EscapeHatchReporter,
  EscapeHatchTarget,
  EscapeHatchUseEvent,
  TenantId,
} from "../engine/types/index.js";
import type { Logger } from "../logging/types.js";
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

const consoleLogger: Logger = {
  info() {},
  warn(msg, data) {
    // biome-ignore lint/suspicious/noConsole: fallback for callers without a logger — dropping the call would lose the report silently.
    console.warn(msg, data);
  },
  error(msg, data) {
    // biome-ignore lint/suspicious/noConsole: same fallback, see warn above.
    console.error(msg, data);
  },
  debug() {},
  child() {
    return consoleLogger;
  },
};

function eventFields(event: EscapeHatchUseEvent): Record<string, unknown> {
  return {
    handler: event.handler,
    kind: event.kind,
    reason: event.reason,
    tenantId: event.tenantId,
    actor: event.actor,
    ...(event.target && { targetId: event.target.id, targetTenantId: event.target.tenantId }),
  };
}

export function reportEscapeHatchUse(
  event: EscapeHatchUseEvent,
  deps: { readonly sink?: EscapeHatchAuditSink; readonly log?: Logger },
): void {
  const logger = deps.log ?? consoleLogger;
  const fields = eventFields(event);
  if (deps.sink) {
    void deps.sink(event).catch((err: unknown) => {
      logger.error(`${ESCAPE_HATCH_USED_SIGNAL}: audit sink failed`, {
        ...fields,
        error: err instanceof Error ? err.message : String(err),
      });
    });
    return;
  }
  logger.warn(ESCAPE_HATCH_USED_SIGNAL, fields);
}

export function createEscapeHatchReporter(opts: {
  readonly handler: string;
  readonly tenantId: TenantId;
  readonly actor: string;
  readonly sink?: EscapeHatchAuditSink;
  readonly log?: Logger;
  readonly window?: EscapeHatchReportWindow;
  readonly processDedup?: EscapeHatchProcessDedup;
  readonly meter?: Meter;
  readonly now?: () => number;
}): EscapeHatchReporter {
  const window = opts.window ?? fallbackReportWindow;
  const now = opts.now ?? Date.now;

  return (kind: EscapeHatchKind, reason: string, target?: EscapeHatchTarget) => {
    if (opts.meter) emitEscapeHatchUse(opts.meter, opts.handler, kind);
    const { processDedup } = opts;
    if (processDedup?.kinds.has(kind)) {
      const processKey = JSON.stringify([opts.handler, kind, opts.tenantId]);
      // skip: this (handler, kind, tenant) was already audited by this process
      if (processDedup.seen.has(processKey)) return;
      processDedup.seen.add(processKey);
      reportEscapeHatchUse(
        { handler: opts.handler, kind, reason, tenantId: opts.tenantId, actor: opts.actor, target },
        { sink: opts.sink, log: opts.log },
      );
      // skip: audited above, the window dedup below only serves the other kinds
      return;
    }
    const key = JSON.stringify([
      opts.handler,
      kind,
      reason,
      opts.tenantId,
      opts.actor,
      target?.id ?? null,
      target?.tenantId ?? null,
    ]);
    // skip: same (handler, kind, reason, target) already reported within the window — dedup
    if (!window.shouldReport(key, now())) return;
    reportEscapeHatchUse(
      { handler: opts.handler, kind, reason, tenantId: opts.tenantId, actor: opts.actor, target },
      { sink: opts.sink, log: opts.log },
    );
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
  });
}
