import type { SseEvent } from "../api/sse-broker";
import type { SaveContext } from "../engine/types";
import type { AuditTrailEntry, AuditTrailStorage } from "../pipeline/system-hooks";

export type EventCollector = {
  readonly audit: AuditTrailEntry[];
  readonly sse: SseEvent[];
  readonly postSave: SaveContext[];
  /** Clears all collected events — call in beforeEach for per-test isolation */
  reset(): void;
  /** AuditTrailStorage compatible — pass to createAuditTrailHook / createAuditTrailDeleteHook */
  readonly auditStorage: AuditTrailStorage;
};

export function createEventCollector(): EventCollector {
  const audit: AuditTrailEntry[] = [];
  const sse: SseEvent[] = [];
  const postSave: SaveContext[] = [];

  return {
    audit,
    sse,
    postSave,
    reset() {
      audit.length = 0;
      sse.length = 0;
      postSave.length = 0;
    },
    auditStorage: {
      append: async (entry) => {
        audit.push(entry);
      },
    },
  };
}
