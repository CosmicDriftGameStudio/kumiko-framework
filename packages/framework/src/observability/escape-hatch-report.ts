import type {
  EscapeHatchAuditSink,
  EscapeHatchKind,
  EscapeHatchReporter,
  EscapeHatchTarget,
  EscapeHatchUseEvent,
  TenantId,
} from "../engine/types";
import type { Logger } from "../logging/types";

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

// Default window for createEscapeHatchReporter callers that don't pass their own.
const fallbackReportWindow = createEscapeHatchReportWindow();

const consoleLogger: Logger = {
  info() {},
  warn(msg, data) {
    // biome-ignore lint/suspicious/noConsole: this is the final fallback when no logger is wired
    console.warn(msg, data);
  },
  error(msg, data) {
    // biome-ignore lint/suspicious/noConsole: this is the final fallback when no logger is wired
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
}): EscapeHatchReporter {
  const window = opts.window ?? fallbackReportWindow;

  return (kind: EscapeHatchKind, reason: string, target?: EscapeHatchTarget) => {
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
    if (!window.shouldReport(key, Date.now())) return;
    reportEscapeHatchUse(
      { handler: opts.handler, kind, reason, tenantId: opts.tenantId, actor: opts.actor, target },
      { sink: opts.sink, log: opts.log },
    );
  };
}

export function fallbackEscapeHatchReporter(tenantId: TenantId): EscapeHatchReporter {
  return createEscapeHatchReporter({
    handler: "<unattributed>",
    tenantId,
    actor: "<unattributed>",
  });
}
