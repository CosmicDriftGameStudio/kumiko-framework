import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Project, type SourceFile } from "ts-morph";
import { createUnsafeAppendEventGuard } from "../guard-unsafe-append-event";

function files(map: Record<string, string>): SourceFile[] {
  const project = new Project({ skipAddingFilesFromTsConfig: true, useInMemoryFileSystem: true });
  for (const [path, source] of Object.entries(map)) project.createSourceFile(path, source);
  return project.getSourceFiles();
}

const dir = mkdtempSync(join(tmpdir(), "unsafe-append-baseline-"));
let baselineCount = 0;
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function baselineWith(perFile: Record<string, number>): string {
  const file = join(dir, `baseline-${baselineCount++}.json`);
  const total = Object.values(perFile).reduce((sum, n) => sum + n, 0);
  writeFileSync(file, JSON.stringify({ format: 1, generated: "2026-10-19", total, perFile }));
  return file;
}

const NO_BASELINE = join(tmpdir(), "unsafe-append-event-missing-baseline.json");
const guard = createUnsafeAppendEventGuard(baselineWith({}));

const CALL = `export async function run(ctx: { unsafeAppendEvent(a: unknown): Promise<void> }) {
  await ctx.unsafeAppendEvent({});
}`;

describe("Unsafe-Append-Event Guard", () => {
  test("flags a call in feature code", () => {
    const { violations } = guard.run(files({ "packages/bundled-features/src/x/handler.ts": CALL }));
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain("unsafeAppendEvent");
  });

  test.each([
    "packages/bundled-features/src/x/migrations/001.ts",
    "packages/bundled-features/src/x/upcasters/v2.ts",
    "packages/bundled-features/src/x/__tests__/handler.test.ts",
  ])("allows %s", (path) => {
    expect(guard.run(files({ [path]: CALL })).violations).toHaveLength(0);
  });

  test.each([
    ["element access", `export const run = (ctx: any) => ctx["unsafeAppendEvent"]({});`],
    [
      "destructured variable",
      `export const run = (ctx: any) => { const { unsafeAppendEvent } = ctx; return unsafeAppendEvent({}); };`,
    ],
    [
      "destructured parameter",
      `export const run = ({ unsafeAppendEvent }: any) => unsafeAppendEvent({});`,
    ],
    [
      "renamed destructuring",
      `export const run = ({ unsafeAppendEvent: append }: any) => append({});`,
    ],
  ])("flags %s", (_label, source) => {
    const { violations } = guard.run(
      files({ "packages/bundled-features/src/x/handler.ts": source }),
    );
    expect(violations).toHaveLength(1);
  });

  test("does not allow a .integration.ts source file or a look-alike folder", () => {
    for (const path of [
      "packages/bundled-features/src/x/seed.integration.ts",
      "packages/bundled-features/src/x/migrations-helper/run.ts",
    ]) {
      expect(guard.run(files({ [path]: CALL })).violations).toHaveLength(1);
    }
  });

  test("ignores the typed appendEvent and tryAppendEvent", () => {
    const source = `export async function run(ctx: { appendEvent(a: unknown): Promise<void>; tryAppendEvent(a: unknown): Promise<void> }) {
  await ctx.appendEvent({});
  await ctx.tryAppendEvent({});
}`;
    expect(
      guard.run(files({ "packages/bundled-features/src/x/handler.ts": source })).violations,
    ).toHaveLength(0);
  });

  describe("baseline ratchet", () => {
    const path = "packages/bundled-features/src/x/handler.ts";
    const TWO_CALLS = `export async function run(ctx: { unsafeAppendEvent(a: unknown): Promise<void> }) {
  await ctx.unsafeAppendEvent({});
  await ctx.unsafeAppendEvent({});
}`;

    test("a finding frozen in the baseline passes", () => {
      const frozen = createUnsafeAppendEventGuard(baselineWith({ [path]: 1 }));
      expect(frozen.run(files({ [path]: CALL })).violations).toHaveLength(0);
    });

    test("a finding beyond the baseline fails", () => {
      const frozen = createUnsafeAppendEventGuard(baselineWith({ [path]: 1 }));
      const { violations } = frozen.run(files({ [path]: TWO_CALLS }));
      expect(violations).toHaveLength(1);
      expect(violations[0]?.message).toContain("over baseline");
    });

    test("a reduced count passes", () => {
      const frozen = createUnsafeAppendEventGuard(baselineWith({ [path]: 3 }));
      expect(frozen.run(files({ [path]: CALL })).violations).toHaveLength(0);
    });

    test("a file missing from the baseline fails", () => {
      const frozen = createUnsafeAppendEventGuard(baselineWith({ "other.ts": 5 }));
      expect(frozen.run(files({ [path]: CALL })).violations).toHaveLength(1);
    });

    test("without a baseline file the guard only warns", () => {
      const unfrozen = createUnsafeAppendEventGuard(NO_BASELINE);
      expect(unfrozen.run(files({ [path]: CALL })).violations).toHaveLength(0);
    });
  });
});
