import { describe, expect, test } from "bun:test";
import * as z from "zod";
import { kmsSlotsOf, parseEnv, withOptionalEnvKeys } from "../index.js";

const schema = z.object({
  KEK: z.string().meta({ kumiko: { kms: true } }),
  OTHER: z.string(),
});

describe("withOptionalEnvKeys", () => {
  test("named keys may be missing, other keys stay required", () => {
    const relaxed = withOptionalEnvKeys(schema, ["KEK"]);
    expect(parseEnv(relaxed, { OTHER: "x" })).toEqual({ OTHER: "x" });
    expect(() => parseEnv(relaxed, { KEK: "k" })).toThrow();
  });

  test("keeps the kms slot visible and ignores keys not in the shape", () => {
    const relaxed = withOptionalEnvKeys(schema, ["KEK", "NOT_IN_SHAPE"]);
    expect(kmsSlotsOf(relaxed)).toEqual(["KEK"]);
    expect(withOptionalEnvKeys(schema, ["NOT_IN_SHAPE"])).toBe(schema);
  });
});
