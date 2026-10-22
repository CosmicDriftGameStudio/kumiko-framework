// Pure qualified-name logic tests.
//
// lastSegment (qn.ts) is the inverse of qualifyScreenId/qualifyNavId
// (kumiko-screen.tsx): the schema stores qualified names, while the
// renderer and URL use the short form. The roundtrip verifies this symmetry.

import { describe, expect, test } from "bun:test";
import { qualifyNavId, qualifyScreenId } from "../kumiko-screen.tsx";
import { lastSegment } from "../qn.ts";

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
