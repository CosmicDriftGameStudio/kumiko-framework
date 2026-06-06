// Qualified-Name Pure-Logik Tests (Phase 1, test-luecken-integration, Tier 1).
//
// lastSegment (qn.ts) ist die Inverse von qualifyScreenId/qualifyNavId
// (kumiko-screen.tsx) — Schema speichert QN-Form, der Renderer/die URL
// nutzt Short-Form. Roundtrip pinnt diese Symmetrie.

import { describe, expect, test } from "bun:test";
import { qualifyNavId, qualifyScreenId } from "../kumiko-screen";
import { lastSegment } from "../qn";

describe("lastSegment", () => {
  test("nimmt den letzten ':'-getrennten Teil", () => {
    expect(lastSegment("tasks:screen:task-list")).toBe("task-list");
    expect(lastSegment("a:b")).toBe("b");
  });

  test("String ohne ':' bleibt unverändert (Short-Form passt durch)", () => {
    expect(lastSegment("task-list")).toBe("task-list");
    expect(lastSegment("")).toBe("");
  });

  test("trailing ':' → leerer Suffix", () => {
    expect(lastSegment("a:")).toBe("");
  });
});

describe("qualifyScreenId / qualifyNavId", () => {
  test("baut featureName:screen:id bzw. featureName:nav:id", () => {
    expect(qualifyScreenId("tasks", "task-list")).toBe("tasks:screen:task-list");
    expect(qualifyNavId("tasks", "main")).toBe("tasks:nav:main");
  });

  test("lastSegment ist die Inverse von qualify*", () => {
    expect(lastSegment(qualifyScreenId("tasks", "task-list"))).toBe("task-list");
    expect(lastSegment(qualifyNavId("tasks", "main"))).toBe("main");
  });
});
