import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findBundledListsWiringErrors } from "../managed-files/bundled-lists-wiring.ts";

function configWith(extra: string): string {
  return `export default defineAppConfig({ features: [], client: { entries: [] }, ports: { dev: 1, e2e: 2 }, ${extra} });`;
}

let appRoot: string;

beforeEach(() => {
  appRoot = mkdtempSync(join(tmpdir(), "kumiko-bundled-lists-"));
  mkdirSync(join(appRoot, "bin"));
});
afterEach(() => {
  rmSync(appRoot, { recursive: true, force: true });
});

function write(path: string, content: string): void {
  writeFileSync(join(appRoot, path), content);
}

describe("bundledLists wiring", () => {
  test("a runner without bundledLists fails when the config sets it", () => {
    write("kumiko.config.ts", configWith("bundledLists: { table: { columnPicker: true } },"));
    write("bin/main.ts", "await runProdApp({ features: APP_FEATURES });");
    write("bin/worker.ts", "await runWorkerApp({ features: APP_FEATURES, bundledLists });");
    const errors = findBundledListsWiringErrors(appRoot);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("bin/main.ts: runProdApp()");
  });

  test("runners passing bundledLists, or spreading options, are accepted", () => {
    write("kumiko.config.ts", configWith("bundledLists: BUNDLED_LISTS,"));
    write("bin/main.ts", "await runProdApp({ features, bundledLists: appConfig.bundledLists });");
    write("bin/dev.ts", "await runDevApp({ ...SHARED_OPTIONS });");
    expect(findBundledListsWiringErrors(appRoot)).toEqual([]);
  });

  test("nothing is required while the config sets no bundledLists", () => {
    write("kumiko.config.ts", configWith(""));
    write("bin/main.ts", "await runProdApp({ features: APP_FEATURES });");
    expect(findBundledListsWiringErrors(appRoot)).toEqual([]);
  });
});
