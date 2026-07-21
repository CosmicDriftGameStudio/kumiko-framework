import { describe, expect, test } from "bun:test";
import type { SseEvent } from "../../api/sse-broker";
import type { SaveContext } from "../../engine/types";
import { createEventCollector } from "../event-collector";

const probeSseEvent: SseEvent = { type: "probe", data: {} };
const probeSaveContext: SaveContext = {
  kind: "save",
  id: "e1",
  data: {},
  changes: {},
  previous: {},
  isNew: true,
};

describe("createEventCollector", () => {
  test("starts empty", () => {
    const collector = createEventCollector();
    expect(collector.sse).toEqual([]);
    expect(collector.postSave).toEqual([]);
  });

  test("reset() clears both arrays in place, keeping the same references", () => {
    const collector = createEventCollector();
    const sseRef = collector.sse;
    const postSaveRef = collector.postSave;
    collector.sse.push(probeSseEvent);
    collector.postSave.push(probeSaveContext);

    expect(collector.sse).toHaveLength(1);
    expect(collector.postSave).toHaveLength(1);

    collector.reset();

    expect(collector.sse).toHaveLength(0);
    expect(collector.postSave).toHaveLength(0);
    // Same array instances — callers that captured a reference before reset
    // still see the cleared state, not a stale snapshot.
    expect(collector.sse).toBe(sseRef);
    expect(collector.postSave).toBe(postSaveRef);
  });
});
