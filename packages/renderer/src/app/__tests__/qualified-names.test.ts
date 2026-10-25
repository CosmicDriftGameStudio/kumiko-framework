// Pure qualified-name logic tests.
//
// lastSegment (qn.ts) is the inverse of qualifyScreenId/qualifyNavId
// (kumiko-screen.tsx): the schema stores qualified names, while the
// renderer and URL use the short form. The roundtrip verifies this symmetry.

import { describe, expect, test } from "bun:test";
import { qualifyNavId, qualifyScreenId } from "../kumiko-screen.tsx";
import { lastSegment } from "../qn.ts";

describe("lastSegment", () => {
  test("returns the last ':'-separated part", () => {
    expect(lastSegment("tasks:screen:task-list")).toBe("task-list");
    expect(lastSegment("a:b")).toBe("b");
  });

  test("A string without ':' remains unchanged (short form passes through)", () => {
    expect(lastSegment("task-list")).toBe("task-list");
    expect(lastSegment("")).toBe("");
  });

  test("trailing ':' → empty suffix", () => {
    expect(lastSegment("a:")).toBe("");
  });
});

describe("qualifyScreenId / qualifyNavId", () => {
  test("baut featureName:screen:id bzw. featureName:nav:id", () => {
    expect(qualifyScreenId("tasks", "task-list")).toBe("tasks:screen:task-list");
    expect(qualifyNavId("tasks", "main")).toBe("tasks:nav:main");
  });

  test("lastSegment is the inverse of qualify*", () => {
    expect(lastSegment(qualifyScreenId("tasks", "task-list"))).toBe("task-list");
    expect(lastSegment(qualifyNavId("tasks", "main"))).toBe("main");
  });
});
