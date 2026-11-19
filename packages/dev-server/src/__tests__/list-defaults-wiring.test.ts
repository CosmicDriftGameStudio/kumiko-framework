import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findListDefaultsWiringErrors } from "../managed-files/list-defaults-wiring.ts";

function configWith(extra: string): string {
  return `export default defineAppConfig({ features: [], client: { entries: [] }, ports: { dev: 1, e2e: 2 }, ${extra} });`;
}

let appRoot: string;

beforeEach(() => {
  appRoot = mkdtempSync(join(tmpdir(), "kumiko-list-defaults-"));
  mkdirSync(join(appRoot, "bin"));
});
afterEach(() => {
  rmSync(appRoot, { recursive: true, force: true });
});

function write(path: string, content: string): void {
  writeFileSync(join(appRoot, path), content);
}

describe("listDefaults wiring", () => {
  test("a runner without listDefaults fails when the config sets it", () => {
    write("kumiko.config.ts", configWith("listDefaults: { table: { columnPicker: true } },"));
    write("bin/main.ts", "await runProdApp({ features: APP_FEATURES });");
    write("bin/worker.ts", "await runWorkerApp({ features: APP_FEATURES, listDefaults });");
    const errors = findListDefaultsWiringErrors(appRoot);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("bin/main.ts: runProdApp()");
  });

  test("runners passing listDefaults, or spreading options, are accepted", () => {
    write("kumiko.config.ts", configWith("listDefaults: LIST_DEFAULTS,"));
    write("bin/main.ts", "await runProdApp({ features, listDefaults: appConfig.listDefaults });");
    write("bin/dev.ts", "await runDevApp({ ...SHARED_OPTIONS });");
    expect(findListDefaultsWiringErrors(appRoot)).toEqual([]);
  });

  test("nothing is required while the config sets no listDefaults", () => {
    write("kumiko.config.ts", configWith(""));
    write("bin/main.ts", "await runProdApp({ features: APP_FEATURES });");
    expect(findListDefaultsWiringErrors(appRoot)).toEqual([]);
  });
});
