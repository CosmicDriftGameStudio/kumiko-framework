import type { SseEvent } from "../api/sse-broker.js";
import type { SaveContext } from "../engine/types/index.js";

export type EventCollector = {
  readonly sse: SseEvent[];
  readonly postSave: SaveContext[];
  /** Clears all collected events — call in beforeEach for per-test isolation */
  reset(): void;
};

export function createEventCollector(): EventCollector {
  const sse: SseEvent[] = [];
  const postSave: SaveContext[] = [];

  return {
    sse,
    postSave,
    reset() {
      sse.length = 0;
      postSave.length = 0;
    },
  };
}
