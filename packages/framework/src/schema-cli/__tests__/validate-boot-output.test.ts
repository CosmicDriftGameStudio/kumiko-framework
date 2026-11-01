import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runSchemaCli } from "../../schema-cli.ts";

const defineFeaturePath = fileURLToPath(new URL("../../engine/define-feature.ts", import.meta.url));

const SCHEMA_SOURCE = `
import { defineFeature } from ${JSON.stringify(defineFeaturePath)};
export const ENTITY_METAS = [];
const dangling = (name) =>
  defineFeature(name, (r) => {
    r.nav({ id: "home", label: "Home", screen: name + ":screen:missing" });
  });
export const FEATURES = [dangling("alpha"), dangling("beta")];
`;

const CLASSIFIED_SCHEMA_SOURCE = `
import { defineFeature } from ${JSON.stringify(defineFeaturePath)};
export const ENTITY_METAS = [];
export const FEATURES = [
  defineFeature("gamma", (r) => {
    r.usesApi("gamma-missing-api");
  }),
];
`;

const DEFINITION_VIOLATIONS_SCHEMA_SOURCE = `
import { defineFeature } from ${JSON.stringify(defineFeaturePath)};
export const ENTITY_METAS = [];
export const FEATURES = [
  defineFeature("delta", (r) => {
    r.nav({ id: "Bad_Id", label: "Home", screen: "delta:screen:home" });
    r.describe("one");
    r.describe("two");
  }),
  defineFeature("epsilon", (r) => {
    r.nav({ id: "Other_Bad", label: "Home", screen: "epsilon:screen:home" });
  }),
];
`;

type Captured = { readonly stdout: string[]; readonly stderr: string[] };

async function runValidate(appDir: string, args: readonly string[]) {
  const captured: Captured = { stdout: [], stderr: [] };
  const exitCode = await runSchemaCli(["validate", ...args], appDir, {
    log: (line) => void captured.stdout.push(line),
    err: (line) => void captured.stderr.push(line),
  });
  return { exitCode, ...captured };
}

describe("kumiko-schema validate boot output", () => {
  let appDir: string;
  const databaseUrl = process.env["DATABASE_URL"];

  beforeAll(() => {
    delete process.env["DATABASE_URL"];
    appDir = mkdtempSync(join(tmpdir(), "kumiko-validate-boot-"));
    mkdirSync(join(appDir, "kumiko", "migrations"), { recursive: true });
    writeFileSync(join(appDir, "kumiko", "schema.ts"), SCHEMA_SOURCE);
  });

  afterAll(() => {
    rmSync(appDir, { recursive: true, force: true });
    if (databaseUrl !== undefined) process.env["DATABASE_URL"] = databaseUrl;
  });

  test("prints one ✗ line per violation", async () => {
    const { exitCode, stderr } = await runValidate(appDir, []);
    expect(exitCode).toBe(1);
    const bootLines = stderr.filter((line) => line.startsWith("  ✗ boot"));
    expect(bootLines).toHaveLength(2);
    expect(bootLines[0]).toContain("[nav/screen-unregistered]");
    expect(bootLines[0]).toContain("alpha:screen:missing");
    expect(bootLines[1]).toContain("beta:screen:missing");
  });

  test("a classified violation prints its fix and a rule link", async () => {
    const classifiedDir = mkdtempSync(join(tmpdir(), "kumiko-validate-classified-"));
    mkdirSync(join(classifiedDir, "kumiko", "migrations"), { recursive: true });
    writeFileSync(join(classifiedDir, "kumiko", "schema.ts"), CLASSIFIED_SCHEMA_SOURCE);
    try {
      const { exitCode, stderr } = await runValidate(classifiedDir, []);
      expect(exitCode).toBe(1);
      const ruleLine = stderr.findIndex((line) => line.startsWith("  ✗ boot [api/unknown-api]"));
      expect(ruleLine).toBeGreaterThanOrEqual(0);
      expect(stderr[ruleLine + 1]).toStartWith("    Fix: ");
      expect(stderr[ruleLine + 2]).toBe("    Rule: agents/boot-rules.md#api-unknown-api");
    } finally {
      rmSync(classifiedDir, { recursive: true, force: true });
    }
  });

  test("collects definition-layer violations of all features in one run", async () => {
    // One directory per run: the imported schema.ts is cached per process.
    const makeDir = () => {
      const dir = mkdtempSync(join(tmpdir(), "kumiko-validate-definition-"));
      mkdirSync(join(dir, "kumiko", "migrations"), { recursive: true });
      writeFileSync(join(dir, "kumiko", "schema.ts"), DEFINITION_VIOLATIONS_SCHEMA_SOURCE);
      return dir;
    };
    const definitionDir = makeDir();
    const jsonDir = makeDir();
    try {
      const text = await runValidate(definitionDir, []);
      expect(text.exitCode).toBe(1);
      const bootLines = text.stderr.filter((line) => line.startsWith("  ✗ boot"));
      expect(bootLines).toHaveLength(3);
      expect(bootLines[0]).toStartWith("  ✗ boot [nav/id-not-kebab]");
      expect(bootLines[1]).toStartWith("  ✗ boot [feature/describe-twice]");
      expect(bootLines[2]).toStartWith("  ✗ boot [nav/id-not-kebab]");
      const ruleLine = text.stderr.findIndex((line) =>
        line.startsWith("  ✗ boot [nav/id-not-kebab]"),
      );
      expect(text.stderr[ruleLine + 1]).toStartWith("    Fix: ");
      expect(text.stderr[ruleLine + 2]).toBe("    Rule: agents/boot-rules.md#nav-id-not-kebab");

      const json = await runValidate(jsonDir, ["--json"]);
      expect(json.exitCode).toBe(1);
      expect(json.stdout).toHaveLength(1);
      expect(JSON.parse(json.stdout[0] ?? "")).toMatchObject({
        boot: {
          ok: false,
          violations: [
            { ruleId: "nav/id-not-kebab", check: "r.nav", feature: "delta" },
            { ruleId: "feature/describe-twice", check: "r.describe", feature: "delta" },
            { ruleId: "nav/id-not-kebab", check: "r.nav", feature: "epsilon" },
          ],
        },
      });
    } finally {
      rmSync(definitionDir, { recursive: true, force: true });
      rmSync(jsonDir, { recursive: true, force: true });
    }
  });

  test("--json prints exactly one parsable document on stdout and the human lines on stderr", async () => {
    const { exitCode, stdout, stderr } = await runValidate(appDir, ["--json"]);
    expect(exitCode).toBe(1);
    expect(stdout).toHaveLength(1);
    const parsed: unknown = JSON.parse(stdout[0] ?? "");
    expect(parsed).toMatchObject({
      boot: {
        ok: false,
        violations: [
          { ruleId: "nav/screen-unregistered", check: "validateNavs", feature: "alpha" },
          { ruleId: "nav/screen-unregistered", check: "validateNavs", feature: "beta" },
        ],
      },
    });
    expect(stderr.filter((line) => line.startsWith("  ✗ boot"))).toHaveLength(2);
  });

  test("--json still prints one document when kumiko/schema.ts is missing", async () => {
    const emptyDir = mkdtempSync(join(tmpdir(), "kumiko-validate-noschema-"));
    try {
      const { exitCode, stdout } = await runValidate(emptyDir, ["--json"]);
      expect(exitCode).toBe(1);
      expect(stdout).toHaveLength(1);
      expect(JSON.parse(stdout[0] ?? "")).toMatchObject({
        boot: {
          ok: false,
          violations: [{ ruleId: "unclassified/loadSchemaMod", check: "loadSchemaMod" }],
        },
      });
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  test("--json reports skipped when kumiko/schema.ts exports no FEATURES", async () => {
    const plainDir = mkdtempSync(join(tmpdir(), "kumiko-validate-nofeatures-"));
    mkdirSync(join(plainDir, "kumiko", "migrations"), { recursive: true });
    writeFileSync(join(plainDir, "kumiko", "schema.ts"), "export const ENTITY_METAS = [];\n");
    try {
      const { stdout } = await runValidate(plainDir, ["--json"]);
      expect(stdout).toHaveLength(1);
      expect(JSON.parse(stdout[0] ?? "")).toEqual({
        boot: { ok: true, skipped: true, violations: [] },
      });
    } finally {
      rmSync(plainDir, { recursive: true, force: true });
    }
  });
});
