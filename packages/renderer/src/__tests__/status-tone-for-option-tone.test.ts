import { describe, expect, test } from "bun:test";
import type { SelectOptionTone } from "@cosmicdrift/kumiko-types/fields";
import { statusToneForOptionTone } from "../primitives.js";

describe("statusToneForOptionTone", () => {
  test("maps declared tones", () => {
    expect(statusToneForOptionTone("ok")).toBe("ok");
    expect(statusToneForOptionTone("neutral")).toBe("muted");
  });

  test("returns undefined for a tone from an untyped definition so callers fall back", () => {
    const unknownTone = "error" as SelectOptionTone;
    expect(statusToneForOptionTone(unknownTone)).toBeUndefined();
    expect(statusToneForOptionTone("constructor" as SelectOptionTone)).toBeUndefined();
  });
});
