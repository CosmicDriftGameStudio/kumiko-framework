import { describe, expect, test } from "bun:test";
import * as z from "zod";
import type { EnvFieldRule } from "../field-rules.ts";
import { inspectEnv, KumikoBootError, parseEnv } from "../index.ts";

const rejectInProduction: EnvFieldRule = (value, env) =>
  env["NODE_ENV"] === "production" ? `no ${value}` : undefined;

const schema = z.object({
  NODE_ENV: z.string().optional(),
  ENDPOINT: z
    .string()
    .optional()
    .meta({
      kumiko: {
        envRule: rejectInProduction,
      },
    }),
});

describe("env field rule", () => {
  test("parseEnv rejects a set field when the rule reads the booted env", () => {
    expect(() => parseEnv(schema, { NODE_ENV: "production", ENDPOINT: "x" })).toThrow(
      KumikoBootError,
    );
    expect(parseEnv(schema, { ENDPOINT: "x" }).ENDPOINT).toBe("x");
  });

  test("inspectEnv flags the field as invalid without echoing the value", () => {
    const rows = inspectEnv(schema, { NODE_ENV: "production", ENDPOINT: "x" });
    const row = rows.find((r) => r.name === "ENDPOINT");
    expect(row?.status).toBe("invalid");
  });

  test("an unset field is not checked", () => {
    expect(parseEnv(schema, { NODE_ENV: "production" }).ENDPOINT).toBeUndefined();
  });
});
