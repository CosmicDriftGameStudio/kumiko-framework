import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  findAppConfigPath,
  loadAppConfig,
  loadAppConfigWithDatabaseUrl,
} from "../load-app-config";

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

describe("findAppConfigPath / loadAppConfigWithDatabaseUrl", () => {
  function ctxIn(cwd: string): { ctx: Parameters<typeof loadAppConfig>[0]; errs: string[] } {
    const errs: string[] = [];
    return {
      errs,
      ctx: { argv: [], cwd, out: { log: () => {}, err: (l) => errs.push(l) } },
    };
  }

  async function withDatabaseUrl<T>(value: string | undefined, body: () => Promise<T>): Promise<T> {
    const previous = process.env["DATABASE_URL"];
    if (value === undefined) delete process.env["DATABASE_URL"];
    else process.env["DATABASE_URL"] = value;
    try {
      return await body();
    } finally {
      if (previous === undefined) delete process.env["DATABASE_URL"];
      else process.env["DATABASE_URL"] = previous;
    }
  }

  test("reports a missing kumiko.config.ts with the defineAppConfig example", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kumiko-app-config-empty-"));
    tmpDirs.push(dir);
    const { ctx, errs } = ctxIn(dir);
    expect(await findAppConfigPath(ctx)).toBeNull();
    const printed = errs.join("\n");
    expect(printed).toContain("kumiko.config.ts not found at:");
    expect(printed).toContain("defineAppConfig");
  });

  test("returns null with a message when DATABASE_URL is unset", async () => {
    const dir = dirname(writeConfig("export default { features: [] };\n"));
    const { ctx, errs } = ctxIn(dir);
    const loaded = await withDatabaseUrl(undefined, () => loadAppConfigWithDatabaseUrl(ctx));
    expect(loaded).toBeNull();
    expect(errs.join("\n")).toContain("DATABASE_URL not set");
  });

  test("returns the config and the database url when both are present", async () => {
    const dir = dirname(writeConfig("export default { features: [] };\n"));
    const { ctx } = ctxIn(dir);
    const loaded = await withDatabaseUrl("postgres://unused.invalid/none", () =>
      loadAppConfigWithDatabaseUrl(ctx),
    );
    expect(loaded).toEqual({
      config: { features: [] },
      databaseUrl: "postgres://unused.invalid/none",
    });
  });
});
