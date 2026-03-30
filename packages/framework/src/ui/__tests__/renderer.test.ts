import { describe, expect, test } from "vitest";
import type { Renderer } from "../types";

describe("Renderer interface", () => {
  test("Renderer type has required methods", () => {
    // Type-level test: creating a mock renderer that satisfies the interface
    const renderer: Renderer = {
      entityList: () => null,
      entityEdit: () => null,
      custom: () => null,
    };

    expect(typeof renderer.entityList).toBe("function");
    expect(typeof renderer.entityEdit).toBe("function");
    expect(typeof renderer.custom).toBe("function");
  });
});
