import { describe, expect, test } from "bun:test";
import * as z from "zod";
import { isDryRunEnvActive, parseDryRunEnvMode, renderEnvInspection } from "../dry-run.ts";
import { inspectEnv } from "../index.ts";

const schema = z.object({
  DATABASE_URL: z.url(),
  SMTP_HOST: z.string().min(1).optional(),
  PORT: z.coerce.number().int().default(3000),
});
const sources = { DATABASE_URL: "framework-core", SMTP_HOST: "channel-email", PORT: "app" };

describe("inspectEnv", () => {
  test("reports a missing required variable instead of throwing", () => {
    const rows = inspectEnv(schema, {}, { sources });

    expect(rows).toEqual([
      { name: "DATABASE_URL", klass: "required", source: "framework-core", status: "missing" },
      { name: "SMTP_HOST", klass: "optional", source: "channel-email", status: "unset" },
      { name: "PORT", klass: "withDefault", source: "app", status: "unset" },
    ]);
  });

  test("marks a malformed value invalid without carrying the value", () => {
    const rows = inspectEnv(schema, { DATABASE_URL: "not-a-url-secret-ish", SMTP_HOST: "mail" });

    const database = rows.find((row) => row.name === "DATABASE_URL");
    expect(database?.status).toBe("invalid");
    expect(JSON.stringify(rows)).not.toContain("not-a-url-secret-ish");
    expect(rows.find((row) => row.name === "SMTP_HOST")?.status).toBe("set");
    expect(database?.source).toBe("unknown");
  });
});

describe("renderEnvInspection", () => {
  test("lists required rows first and summarises what is missing", () => {
    const output = renderEnvInspection(inspectEnv(schema, { PORT: "8080" }, { sources }));

    expect(output).toContain("Env check (values are not printed):");
    expect(output).toMatch(/^\s+DATABASE_URL\s+framework-core\s+required\s+missing$/m);
    expect(output).toMatch(/^\s+PORT\s+app\s+withDefault\s+set$/m);
    expect(output.indexOf("DATABASE_URL")).toBeLessThan(output.indexOf("SMTP_HOST"));
    expect(output).toContain("1 required variable(s) missing.");
    expect(output).not.toContain("8080");
  });

  test("reports invalid variables and a clean env", () => {
    const invalid = renderEnvInspection(inspectEnv(schema, { DATABASE_URL: "nope" }, { sources }));
    const clean = renderEnvInspection(
      inspectEnv(schema, { DATABASE_URL: "postgres://db/app" }, { sources }),
    );

    expect(invalid).toContain("1 variable(s) invalid.");
    expect(invalid).not.toContain("nope");
    expect(clean).toContain("All variables present.");
  });
});

describe("parseDryRunEnvMode", () => {
  test("maps the accepted spellings and rejects unknown ones", () => {
    expect(parseDryRunEnvMode(undefined)).toBeUndefined();
    expect(parseDryRunEnvMode("")).toBeUndefined();
    expect(parseDryRunEnvMode("1")).toBe("human");
    expect(parseDryRunEnvMode("TRUE")).toBe("human");
    expect(parseDryRunEnvMode("boot")).toBe("boot");
    expect(parseDryRunEnvMode("k8s")).toBe("k8s");
    expect(parseDryRunEnvMode("yes")).toBeUndefined();
  });

  test("isDryRunEnvActive follows the parser", () => {
    expect(isDryRunEnvActive({ KUMIKO_DRY_RUN_ENV: "boot" })).toBe(true);
    expect(isDryRunEnvActive({ KUMIKO_DRY_RUN_ENV: "yes" })).toBe(false);
    expect(isDryRunEnvActive({})).toBe(false);
  });
});
