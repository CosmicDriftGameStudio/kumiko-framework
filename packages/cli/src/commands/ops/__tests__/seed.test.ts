import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../../../index";

const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makeCwd(): string {
  const dir = mkdtempSync(join(tmpdir(), "kumiko-ops-seed-"));
  tmpDirs.push(dir);
  return dir;
}

function capture(): {
  out: { log: (s: string) => void; err: (s: string) => void };
  logs: string[];
  errs: string[];
} {
  const logs: string[] = [];
  const errs: string[] = [];
  return { logs, errs, out: { log: (s) => logs.push(s), err: (s) => errs.push(s) } };
}

describe("kumiko ops seed:new / seed:status", () => {
  test("seed:new scaffolds a dated seed file", async () => {
    const cwd = makeCwd();
    const { out } = capture();
    const code = await runCli({ argv: ["ops", "seed:new", "fix-admin-roles"], cwd, out });
    expect(code).toBe(0);
    const files = readdirSync(join(cwd, "seeds"));
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^\d{4}-\d{2}-\d{2}-fix-admin-roles\.ts$/);
    expect(readFileSync(join(cwd, "seeds", files[0] ?? ""), "utf-8")).toContain(
      "satisfies SeedMigration",
    );
  });

  test("seed:new without a slug prints usage", async () => {
    const cwd = makeCwd();
    const { out, errs } = capture();
    const code = await runCli({ argv: ["ops", "seed:new"], cwd, out });
    expect(code).toBe(1);
    expect(errs.join("\n")).toContain("Usage: kumiko ops seed:new");
  });

  test("seed:status without a seeds folder reports no seeds", async () => {
    const cwd = makeCwd();
    const { out, logs } = capture();
    const code = await runCli({ argv: ["ops", "seed:status"], cwd, out });
    expect(code).toBe(0);
    expect(logs.join("\n")).toContain("no seeds found");
  });

  test("seed:status with seeds but no DATABASE_URL fails", async () => {
    const cwd = makeCwd();
    mkdirSync(join(cwd, "seeds"));
    writeFileSync(join(cwd, "seeds", "2026-01-01-a.ts"), "export default {};\n");
    const previous = process.env["DATABASE_URL"];
    delete process.env["DATABASE_URL"];
    try {
      const { out, errs } = capture();
      const code = await runCli({ argv: ["ops", "seed:status"], cwd, out });
      expect(code).toBe(1);
      expect(errs.join("\n")).toContain("DATABASE_URL not set");
    } finally {
      if (previous !== undefined) process.env["DATABASE_URL"] = previous;
    }
  });
});
