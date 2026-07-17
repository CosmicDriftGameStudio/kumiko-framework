import { describe, expect, test } from "bun:test";
import { toKebab as serverToKebab } from "@cosmicdrift/kumiko-framework/engine";
import { lastSegment, toKebab } from "../app/qn";

describe("lastSegment", () => {
  test("strips feature-prefix from screen-QN", () => {
    expect(lastSegment("publicstatus:screen:component-edit")).toBe("component-edit");
  });

  test("strips feature-prefix from nav-QN", () => {
    expect(lastSegment("shop:nav:catalog")).toBe("catalog");
  });

  test("strips feature-prefix from workspace-QN", () => {
    expect(lastSegment("admin:workspace:disposition")).toBe("disposition");
  });

  test("returns short-form input unchanged", () => {
    // Defensive default — an Author who already passes a short id
    // shouldn't get a misformatted result.
    expect(lastSegment("component-edit")).toBe("component-edit");
  });

  test("strips only the LAST segment, not the first", () => {
    // The QN convention is `<feature>:<kind>:<short-id>`. lastIndexOf
    // ensures kebab-ids that themselves contain colons (defensive —
    // kebab spec rejects them, but the helper shouldn't break).
    expect(lastSegment("a:b:c:d")).toBe("d");
  });

  test("handles empty string", () => {
    expect(lastSegment("")).toBe("");
  });

  test("handles trailing colon as empty segment", () => {
    // E.g. when registry stamping is buggy and writes `feature:screen:`
    // — the helper returns "" rather than throwing, the caller's
    // navigate-then-not-found banner makes the bug visible.
    expect(lastSegment("publicstatus:screen:")).toBe("");
  });
});

describe("toKebab", () => {
  test("camelCase entity ids match server qualifyEntityName", () => {
    expect(toKebab("driverModel")).toBe("driver-model");
    expect(toKebab("statementUpload")).toBe("statement-upload");
  });

  test("already kebab unchanged", () => {
    expect(toKebab("driver-model")).toBe("driver-model");
  });

  test("preserves colon segments", () => {
    expect(toKebab("driverModel:list")).toBe("driver-model:list");
  });

  test("consecutive uppercase (acronym boundary)", () => {
    expect(toKebab("SSEBroadcast")).toBe("sse-broadcast");
  });

  test("dot separators become dashes", () => {
    expect(toKebab("billing-period.create")).toBe("billing-period-create");
  });

  // Drift guard: this file is a byte-identical copy of the server's toKebab
  // (packages/framework/src/engine/qualified-name.ts) kept in sync only by
  // convention/comment, not by import (avoids pulling server deps into the
  // browser bundle). Table-driven against the server's own doc examples so a
  // future edit to either copy that breaks parity fails loudly here.
  test("matches the server implementation for its documented examples", () => {
    const cases = [
      "task.create",
      "ticketAssigned",
      "billing-period.create",
      "monthlyReport",
      "SSEBroadcast",
      "driverModel:list",
    ];
    for (const input of cases) {
      expect(toKebab(input)).toBe(serverToKebab(input));
    }
  });
});
