import { describe, expect, test } from "bun:test";
import { assignTagPayloadSchema } from "../schemas";

// 456/3: tagAssignmentAggregateId joins tenantId/tagId/entityType/entityId
// with "|" to derive the stream id — a literal "|" in entityType/entityId
// could shift tuple boundaries and collide with an unrelated combination.
describe("assignTagPayloadSchema — no pipe in entityType/entityId", () => {
  test("accepts normal values", () => {
    const parsed = assignTagPayloadSchema.safeParse({
      tagId: "tag-1",
      entityType: "credit",
      entityId: "entity-1",
    });
    expect(parsed.success).toBe(true);
  });

  test("rejects a pipe in entityType", () => {
    const parsed = assignTagPayloadSchema.safeParse({
      tagId: "tag-1",
      entityType: "credit|forged",
      entityId: "entity-1",
    });
    expect(parsed.success).toBe(false);
  });

  test("rejects a pipe in entityId", () => {
    const parsed = assignTagPayloadSchema.safeParse({
      tagId: "tag-1",
      entityType: "credit",
      entityId: "entity|forged",
    });
    expect(parsed.success).toBe(false);
  });
});
