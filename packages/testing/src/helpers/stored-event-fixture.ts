import type { StoredEvent } from "@cosmicdrift/kumiko-types/event-store-types";

// SaveContext and DeleteContext always carry the event that produced them, so a
// hand-built context in a hook test needs one too.
export function createTestStoredEvent(overrides: Partial<StoredEvent> = {}): StoredEvent {
  return {
    id: "test-event-1",
    aggregateId: "test-aggregate-1",
    aggregateType: "test-aggregate",
    tenantId: "test-tenant-1",
    version: 1,
    type: "test:event:saved",
    eventVersion: 1,
    payload: {},
    metadata: { userId: "test-user-1" },
    createdAt: Temporal.Instant.from("2026-01-01T00:00:00Z"),
    createdBy: "test-user-1",
    ...overrides,
  };
}
