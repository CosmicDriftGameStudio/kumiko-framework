import { describe, expect, test } from "bun:test";
import { folderAssignmentAggregateId } from "../aggregate-id";

// Drift-Pin-Tests — these values are cross-boot contracts. If they go red:
// stop, think, revert. aggregate-id.ts names this file.

const TENANT = "00000000-0000-0000-0000-000000000001";

describe("folders drift pins", () => {
  test("folder-assignment aggregate-id namespace is stable across boots", () => {
    // FOLDER_ASSIGNMENT_NAMESPACE is in stone — changing it re-keys every
    // existing assignment stream and breaks event-replay. If this fails: revert
    // the namespace, do not adjust the expected values.
    const base = folderAssignmentAggregateId(TENANT, "credit", "c-1");

    expect(base).toBe(folderAssignmentAggregateId(TENANT, "credit", "c-1")); // deterministic
    // folderId is NOT part of the key (single-membership): every OTHER tuple
    // component is, with no collisions across the axes.
    expect(base).not.toBe(
      folderAssignmentAggregateId("11111111-1111-1111-1111-111111111111", "credit", "c-1"),
    );
    expect(base).not.toBe(folderAssignmentAggregateId(TENANT, "invoice", "c-1"));
    expect(base).not.toBe(folderAssignmentAggregateId(TENANT, "credit", "c-2"));

    // Pinned actual outputs — the drift-detector for the namespace constant.
    expect(base).toBe("a57e2be6-1831-5d08-9e83-2de64578de6d");
    expect(
      folderAssignmentAggregateId("11111111-1111-1111-1111-111111111111", "credit", "c-1"),
    ).toBe("d2153ce9-5ffa-544e-b850-a4a7fefa7d89");
    expect(folderAssignmentAggregateId(TENANT, "invoice", "c-1")).toBe(
      "7c849492-a806-5e73-a824-e90dfc761e3a",
    );
    expect(folderAssignmentAggregateId(TENANT, "credit", "c-2")).toBe(
      "d9ad71bc-78db-5588-9f61-b77f35229ed3",
    );
  });

  test("aggregate-id format is a valid uuid", () => {
    expect(folderAssignmentAggregateId(TENANT, "credit", "c-1")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });
});
