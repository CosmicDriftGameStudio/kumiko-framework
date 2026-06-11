// st15/7: der Dry-Run-Pfad lieferte `({} as Shape)` — jeder Zugriff silent
// undefined. parseEnvDryRun liefert stattdessen ein ehrliches Partial.

import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { parseEnvDryRun } from "../index";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().int().default(3000),
  DEBUG: z
    .string()
    .optional()
    .transform((v) => v === "1"),
});

describe("parseEnvDryRun", () => {
  test("missing required fields are simply absent — no throw", () => {
    const out = parseEnvDryRun(schema, {});
    expect(out.DATABASE_URL).toBeUndefined();
    expect("DATABASE_URL" in out).toBe(false);
  });

  test("present fields come through parsed/coerced", () => {
    const out = parseEnvDryRun(schema, {
      DATABASE_URL: "postgres://x",
      PORT: "8123",
      DEBUG: "1",
    });
    expect(out.DATABASE_URL).toBe("postgres://x");
    expect(out.PORT).toBe(8123);
    expect(out.DEBUG).toBe(true);
  });

  test("invalid values are dropped instead of throwing (inventory must render)", () => {
    const out = parseEnvDryRun(schema, { PORT: "not-a-number", DATABASE_URL: "postgres://x" });
    expect(out.PORT).toBeUndefined();
    expect(out.DATABASE_URL).toBe("postgres://x");
  });
});
