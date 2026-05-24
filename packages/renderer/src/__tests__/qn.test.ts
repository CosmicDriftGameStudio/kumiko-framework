import { describe, expect, test } from "bun:test";
import { lastSegment } from "../app/qn";

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
