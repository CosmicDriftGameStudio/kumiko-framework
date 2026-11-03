import { describe, expect, test } from "bun:test";
import { eventsTable as table } from "@cosmicdrift/kumiko-framework/event-store";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { countedSetKey } from "../stock-cap-guard.ts";

describe("countedSetKey", () => {
  test("nested operator key order does not change the key", () => {
    const a = countedSetKey({ table, where: { status: { in: ["a", "b"], ne: "x" } } });
    const b = countedSetKey({ table, where: { status: { ne: "x", in: ["a", "b"] } } });
    expect(a).toBe(b);
  });

  test("top-level key order does not change the key", () => {
    const a = countedSetKey({ table, where: { kind: "k", status: "s" } });
    const b = countedSetKey({ table, where: { status: "s", kind: "k" } });
    expect(a).toBe(b);
  });

  test("different Temporal values produce different keys", () => {
    const early = countedSetKey({
      table,
      where: { at: Temporal.Instant.from("2026-01-01T00:00:00Z") },
    });
    const late = countedSetKey({
      table,
      where: { at: Temporal.Instant.from("2026-02-01T00:00:00Z") },
    });
    expect(early).not.toBe(late);
  });

  test("different where clauses produce different keys", () => {
    expect(countedSetKey({ table, where: { status: "a" } })).not.toBe(
      countedSetKey({ table, where: { status: "b" } }),
    );
  });
});
