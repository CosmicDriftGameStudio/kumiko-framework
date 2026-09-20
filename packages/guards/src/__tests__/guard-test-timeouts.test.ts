import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { loadRepoManifest } from "@cosmicdrift/kumiko-repo-manifest";
import { Project, type SourceFile } from "ts-morph";
import type { RepoRoot } from "../_lib/roots";
import { scanFiles } from "../_lib/scan-scope";
import { guard, scanTimeouts } from "../guard-test-timeouts";

const DIR = `${process.cwd()}/packages/framework/src/x`;

function sourceFile(code: string, path = `${DIR}/thing.test.ts`): SourceFile {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    useInMemoryFileSystem: true,
  });
  return project.createSourceFile(path, code);
}

const DECLS =
  "declare const test: { setTimeout(ms: number): void; slow(): void };\n" +
  "declare const page: { waitForTimeout(ms: number): Promise<void> };\n" +
  "declare function sleep(ms: number): Promise<void>;\n" +
  "declare const Bun: { sleep(ms: number): Promise<void> };\n" +
  "declare function ready(): boolean;\n";

function messages(code: string, path?: string): string[] {
  return scanTimeouts(sourceFile(DECLS + code, path)).map((f) => f.message);
}

describe("test-timeouts guard — violations", () => {
  test("flags test.setTimeout", () => {
    expect(messages("test.setTimeout(90_000);")).toEqual([
      expect.stringContaining("test.setTimeout(…) raises the timeout"),
    ]);
  });

  test("flags test.slow", () => {
    expect(messages("test.slow();")).toEqual([expect.stringContaining("test.slow(…)")]);
  });

  test("flags waitForTimeout", () => {
    expect(messages("export const run = () => page.waitForTimeout(500);")).toEqual([
      expect.stringContaining("page.waitForTimeout(…) waits for time"),
    ]);
  });

  test("flags a while loop that sleeps", () => {
    expect(
      messages("export async function poll() { while (!ready()) { await sleep(10); } }"),
    ).toEqual([expect.stringContaining("while loop polls with sleep")]);
  });

  test("flags Bun.sleep inside a do…while and a for…of", () => {
    const found = messages(
      "export async function a() { do { await Bun.sleep(5); } while (!ready()); }\n" +
        "export async function b() { for (const n of [1, 2]) { await Bun.sleep(n); } }",
    );
    expect(found).toHaveLength(2);
    expect(found[0]).toContain("do…while loop");
    expect(found[1]).toContain("for…of loop");
  });

  test("flags a for loop with new Promise + setTimeout, even inside an arrow function", () => {
    const found = messages(
      "export async function w() { for (let i = 0; i < 5; i++) { await (async () => new Promise((r) => setTimeout(r, 50)))(); } }",
    );
    expect(found).toEqual([expect.stringContaining("for loop polls with sleep")]);
  });

  test("reports a nested sleeping loop once, not once per enclosing loop", () => {
    const found = messages(
      "export async function n() { for (let i = 0; i < 2; i++) { while (!ready()) { await sleep(1); } } }",
    );
    expect(found).toEqual([expect.stringContaining("while loop polls with sleep")]);
  });
});

describe("test-timeouts guard — no violation", () => {
  test("a bare sleep or setTimeout outside a loop is work simulation", () => {
    expect(
      messages(
        "export async function a() { await sleep(10); }\n" +
          "export const b = () => new Promise((r) => setTimeout(r, 10));",
      ),
    ).toEqual([]);
  });

  test("a sleeping loop in a generator that yields is a slow producer, not polling", () => {
    expect(
      messages(
        "export async function* slow(items: number[]) { for (const n of items) { await sleep(5); yield n; } }",
      ),
    ).toEqual([]);
  });

  test("a loop without sleep is fine", () => {
    expect(messages("export function c() { for (const n of [1, 2]) { void n; } }")).toEqual([]);
  });

  test("a new Promise in a loop that never calls setTimeout is fine", () => {
    expect(
      messages(
        "export function d() { for (const n of [1, 2]) { void new Promise((r) => r(n)); } }",
      ),
    ).toEqual([]);
  });

  test("a complete @timeout-exception marker on the line above suppresses the finding", () => {
    expect(
      messages(
        "// @timeout-exception: #3120 cold-start of the sidecar takes 40s\ntest.setTimeout(60_000);",
      ),
    ).toEqual([]);
  });

  test("a complete marker on the loop line suppresses a sleep loop", () => {
    expect(
      messages(
        "export async function p() {\n  while (!ready()) { // @timeout-exception: #12 external queue has no callback\n    await sleep(10);\n  }\n}",
      ),
    ).toEqual([]);
  });

  test("samples/recipes is never scanned", () => {
    expect(
      messages(
        "test.setTimeout(1);",
        `${process.cwd()}/samples/recipes/apex-landing/e2e/x.spec.ts`,
      ),
    ).toEqual([]);
  });
});

describe("test-timeouts guard — incomplete marker", () => {
  test.each([
    ["no issue number", "// @timeout-exception: cold start"],
    ["no reason", "// @timeout-exception: #3120"],
    ["no colon", "// @timeout-exception #3120 cold start"],
    ["bare tag", "// @timeout-exception"],
  ])("%s does not suppress and is called out", (_label, marker) => {
    const found = messages(`${marker}\ntest.setTimeout(60_000);`);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain("incomplete @timeout-exception marker");
  });
});

describe("test-timeouts guard — scan scope reaches Playwright dirs outside sourceRoots/testGlobs", () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const cleanup of cleanups) cleanup();
    cleanups.length = 0;
  });

  function write(dir: string, rel: string): void {
    mkdirSync(join(dir, rel, ".."), { recursive: true });
    writeFileSync(join(dir, rel), "export {};\n");
  }

  test("app layout: e2e/** is picked up next to src tests, non-test src files and node_modules are not", () => {
    const dir = mkdtempSync(join(tmpdir(), "test-timeouts-scope-"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    writeFileSync(
      join(dir, "kumiko.json"),
      JSON.stringify({
        kind: "app",
        sourceRoots: ["src", "bin"],
        testGlobs: ["src/**/*.{test,integration}.{ts,tsx}"],
        excludes: ["**/node_modules/**"],
      }),
    );
    write(dir, "src/a.test.ts");
    write(dir, "src/a.ts");
    write(dir, "e2e/flows/run.spec.ts");
    write(dir, "e2e/screenshots/scenarios.ts");
    write(dir, "e2e/node_modules/dep/index.ts");
    const loaded = loadRepoManifest(dir);
    const root: RepoRoot = {
      name: "app",
      absPath: dir,
      kind: loaded.manifest.kind,
      manifest: loaded.manifest,
      manifestSource: loaded.source,
    };
    const files = scanFiles(guard.scan, [root]).map((f) => relative(dir, f));
    expect(files).toEqual([
      "e2e/flows/run.spec.ts",
      "e2e/screenshots/scenarios.ts",
      "src/a.test.ts",
    ]);
  });
});
