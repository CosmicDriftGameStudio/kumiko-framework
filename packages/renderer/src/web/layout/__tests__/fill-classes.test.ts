import { describe, expect, test } from "bun:test";
import { fillClasses } from "../fill-classes.ts";

describe("fillClasses", () => {
  test("inset carries min-w-0 with and without fill, so wide content scrolls inside the inset", () => {
    expect(fillClasses(true).inset.split(" ")).toContain("min-w-0");
    expect(fillClasses(false).inset.split(" ")).toContain("min-w-0");
    expect(fillClasses(undefined).inset.split(" ")).toContain("min-w-0");
  });

  test("fill additionally constrains height on provider and inset", () => {
    // The marker lets styles.css shrink the shell below the offline banner.
    expect(fillClasses(true).provider).toEqual({ className: "h-svh", "data-kumiko-fill": "true" });
    expect(fillClasses(true).inset.split(" ")).toContain("min-h-0");
    expect(fillClasses(undefined).provider).toEqual({});
    expect(fillClasses(undefined).inset.split(" ")).not.toContain("min-h-0");
  });
});
