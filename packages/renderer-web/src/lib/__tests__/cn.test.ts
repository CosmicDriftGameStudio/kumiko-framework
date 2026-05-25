import { describe, expect, test } from "bun:test";
import { cn } from "../cn";

describe("cn", () => {
  test("merges conditional classes and resolves tailwind conflicts", () => {
    expect(cn("px-2", false && "hidden", "px-4")).toBe("px-4");
  });

  test("joins unrelated classes", () => {
    expect(cn("text-sm", "font-bold")).toBe("text-sm font-bold");
  });
});
