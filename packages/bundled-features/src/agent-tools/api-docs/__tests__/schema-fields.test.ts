import { describe, expect, test } from "bun:test";
import * as z from "zod";
import { typeLabel } from "../schema-fields.ts";

function labelOf(schema: z.ZodType): string {
  return typeLabel(z.toJSONSchema(schema, { io: "input" }));
}

describe("typeLabel", () => {
  test("a nullable string is labelled with its type and null", () => {
    expect(labelOf(z.string().nullable().optional())).toBe("string | null");
  });

  test("a nullable string keeps its format", () => {
    expect(labelOf(z.string().email().nullable())).toBe("string (email) | null");
  });

  test("a plain number stays a number", () => {
    expect(labelOf(z.number())).toBe("number");
  });
});
