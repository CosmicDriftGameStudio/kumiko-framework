import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runManagedCheckStep } from "../check-managed";
import { runScriptsCheckStep } from "../check-scripts";

const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const DEFINED_CONFIG = `import { defineAppConfig } from "@cosmicdrift/kumiko-framework/config";
export default defineAppConfig({ features: [], client: { entries: ["src/client.tsx"] }, ports: { dev: 4173, e2e: 4174 } });
`;

function appRepo(options: { readonly name: string; readonly config?: string }): string {
  const dir = mkdtempSync(join(tmpdir(), "kumiko-check-managed-"));
  tmpDirs.push(dir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: options.name }));
  writeFileSync(
    join(dir, "kumiko.config.ts"),
    options.config ?? "export default { features: [] };\n",
  );
  return dir;
}

function capture(): {
  out: { log: (s: string) => void; err: (s: string) => void };
  logs: string[];
} {
  const logs: string[] = [];
  return { logs, out: { log: (s) => logs.push(s), err: (s) => logs.push(s) } };
}

describe("runManagedCheckStep when the app facts cannot be resolved", () => {
  test("warns and passes before defineAppConfig is adopted", async () => {
    const { out, logs } = capture();
    const repo = appRepo({ name: "@scope/not-kebab" });

    expect(await runManagedCheckStep(out, repo, [])).toBe(0);
    expect(logs.join("\n")).toContain("kebab-case");
    expect(logs.join("\n")).toContain("does not call defineAppConfig yet");
  });

  test("still fails once defineAppConfig is adopted", async () => {
    const { out } = capture();
    const repo = appRepo({ name: "@scope/not-kebab", config: DEFINED_CONFIG });

    await expect(runManagedCheckStep(out, repo, [])).rejects.toThrow("kebab-case");
  });
});

describe("runScriptsCheckStep when package.json scripts are unreadable", () => {
  test("warns and passes before defineAppConfig is adopted", async () => {
    const { out, logs } = capture();
    const repo = appRepo({ name: "legacy-app" });
    writeFileSync(join(repo, "package.json"), JSON.stringify({ name: "legacy-app", scripts: 1 }));

    expect(await runScriptsCheckStep(out, repo, [])).toBe(0);
    expect(logs.join("\n")).toContain('"scripts" must map names to strings');
  });

  test("still fails once defineAppConfig is adopted", async () => {
    const { out } = capture();
    const repo = appRepo({ name: "app", config: DEFINED_CONFIG });
    writeFileSync(join(repo, "package.json"), JSON.stringify({ name: "app", scripts: 1 }));

    await expect(runScriptsCheckStep(out, repo, [])).rejects.toThrow('"scripts" must map');
  });
});

describe("runManagedCheckStep on an adopted app", () => {
  test("fails when kumiko/schema.ts lost its ROW_LEVEL_SECURITY line", async () => {
    const repo = appRepo({ name: "shop-app", config: DEFINED_CONFIG });
    const managed = await import("@cosmicdrift/kumiko-dev-server/managed-files");
    managed.syncManagedFiles(managed.resolveManagedAppFacts({ appRoot: repo, uiRoots: [] }), {
      write: true,
      adopt: false,
    });
    const schemaPath = join(repo, "kumiko/schema.ts");
    const original = readFileSync(schemaPath, "utf-8");
    expect(original).toContain("ROW_LEVEL_SECURITY");
    writeFileSync(
      schemaPath,
      original
        .split("\n")
        .filter((line) => !line.includes("ROW_LEVEL_SECURITY"))
        .join("\n"),
    );

    const { out, logs } = capture();
    expect(await runManagedCheckStep(out, repo, [])).toBe(1);
    expect(logs.join("\n")).toContain("✗ kumiko/schema.ts: differs from the template");
  });
});
