import { describe, expect, test } from "bun:test";
import { generateDeterministicId, generateId } from "../ids";

// generateId is the row/stream/correlation ID source. The callers rely on
// it being a UUIDv7 (time-sortable → dense B-Tree indexes), not a v4 — a
// swap to v4 would silently kill the lexicographic-time ordering the event
// store and time-range queries depend on. These tests pin that contract.
const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("generateId", () => {
  test("returns a well-formed lowercase UUID", () => {
    expect(generateId()).toMatch(UUID_RX);
  });

  test("is UUID version 7 (time-sortable, not v4)", () => {
    // Version nibble lives in the 13th hex digit (index 14 incl. dashes).
    expect(generateId()[14]).toBe("7");
  });

  test("is collision-free across a batch", () => {
    const ids = Array.from({ length: 10_000 }, generateId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("generateDeterministicId", () => {
  test("returns a well-formed lowercase UUID", () => {
    expect(generateDeterministicId("ledger:schedule", "contract-1")).toMatch(UUID_RX);
  });

  test("is UUID version 5 (content-addressed, not v7)", () => {
    expect(generateDeterministicId("ledger:schedule", "contract-1")[14]).toBe("5");
  });

  test("is deterministic: same namespace + key always yields the same id", () => {
    const a = generateDeterministicId("ledger:schedule", "contract-1");
    const b = generateDeterministicId("ledger:schedule", "contract-1");
    expect(a).toBe(b);
  });

  test("differs when the key changes", () => {
    const a = generateDeterministicId("ledger:schedule", "contract-1");
    const b = generateDeterministicId("ledger:schedule", "contract-2");
    expect(a).not.toBe(b);
  });

  test("differs when the namespace changes for the same key", () => {
    const a = generateDeterministicId("ledger:schedule", "contract-1");
    const b = generateDeterministicId("ledger:transaction", "contract-1");
    expect(a).not.toBe(b);
  });
});
