import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadAppConfig } from "../load-app-config";

const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function writeConfig(source: string): string {
  const dir = mkdtempSync(join(tmpdir(), "kumiko-app-config-"));
  tmpDirs.push(dir);
  const path = join(dir, "kumiko.config.ts");
  writeFileSync(path, source);
  return path;
}

function ctxWithErrs(): { ctx: Parameters<typeof loadAppConfig>[0]; errs: string[] } {
  const errs: string[] = [];
  return {
    errs,
    ctx: { argv: [], cwd: process.cwd(), out: { log: () => {}, err: (l) => errs.push(l) } },
  };
}

describe("loadAppConfig", () => {
  test("returns the default export when it carries a features array", async () => {
    const { ctx, errs } = ctxWithErrs();
    const config = await loadAppConfig(ctx, writeConfig("export default { features: [] };\n"));
    expect(config).toEqual({ features: [] });
    expect(errs).toEqual([]);
  });

  test("reports a readable message instead of crashing when features is missing", async () => {
    const { ctx, errs } = ctxWithErrs();
    expect(await loadAppConfig(ctx, writeConfig("export default {};\n"))).toBeNull();
    expect(errs.join("\n")).toContain('"features" array');
  });

  test("reports a readable message when there is no default export", async () => {
    const { ctx, errs } = ctxWithErrs();
    expect(await loadAppConfig(ctx, writeConfig("export const features = [];\n"))).toBeNull();
    expect(errs.join("\n")).toContain('"features" array');
  });
});
