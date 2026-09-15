import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { Project, type SourceFile } from "ts-morph";
import { applySecurityBaseline, type SecurityBaselineLoad } from "../_lib/security-baseline";
import {
  createOpenToAllReasonGuard,
  findDeprecatedOpenToAll,
  findGenericOpenToAllReasons,
} from "../guard-open-to-all-reason";

function files(map: Record<string, string>): SourceFile[] {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    useInMemoryFileSystem: true,
  });
  for (const [p, src] of Object.entries(map)) project.createSourceFile(p, src);
  return project.getSourceFiles();
}

describe("findDeprecatedOpenToAll", () => {
  test("flags openToAll: true", () => {
    const sfs = files({
      "/r/packages/bundled-features/src/foo/handlers/x.write.ts": `
export const a = { access: { openToAll: true } };
`,
    });
    expect(findDeprecatedOpenToAll(sfs, "/r")).toHaveLength(1);
  });

  test("ignores openToAll: { reason: ... }", () => {
    const sfs = files({
      "/r/packages/bundled-features/src/foo/handlers/x.write.ts": `
export const a = { access: { openToAll: { reason: "Any member may read the public status page" } } };
`,
    });
    expect(findDeprecatedOpenToAll(sfs, "/r")).toHaveLength(0);
  });
});

describe("findGenericOpenToAllReasons", () => {
  test("passes a concrete reason", () => {
    const sfs = files({
      "/r/packages/bundled-features/src/foo/handlers/x.write.ts": `
export const a = { access: { openToAll: { reason: "Any member may read the public status page" } } };
`,
    });
    expect(findGenericOpenToAllReasons(sfs, "/r")).toHaveLength(0);
  });

  test("flags a placeholder reason", () => {
    const sfs = files({
      "/r/packages/bundled-features/src/foo/handlers/x.write.ts": `
export const a = { access: { openToAll: { reason: "todo" } } };
`,
    });
    expect(findGenericOpenToAllReasons(sfs, "/r")).toHaveLength(1);
  });

  test("leaves an empty reason to the boot validator (no double-check)", () => {
    const sfs = files({
      "/r/packages/bundled-features/src/foo/handlers/x.write.ts": `
export const a = { access: { openToAll: { reason: "" } } };
`,
    });
    expect(findGenericOpenToAllReasons(sfs, "/r")).toHaveLength(0);
  });

  test("ignores openToAll: true (no reason object to inspect)", () => {
    const sfs = files({
      "/r/packages/bundled-features/src/foo/handlers/x.write.ts": `
export const a = { access: { openToAll: true } };
`,
    });
    expect(findGenericOpenToAllReasons(sfs, "/r")).toHaveLength(0);
  });
});

describe("guard.run (unified security-baseline mechanism)", () => {
  const REL_FILE = "packages/bundled-features/src/foo/handlers/x.write.ts";

  test("deprecated-true findings carry no neverFrozen; the placeholder-reason finding does", () => {
    const sfs = files({
      [`/r/${REL_FILE}`]: `
export const a = { access: { openToAll: true } };
export const b = { access: { openToAll: { reason: "todo" } } };
`,
    });
    const guard = createOpenToAllReasonGuard({ root: "/r" });
    const outcome = guard.run(sfs);
    expect(outcome.violations).toHaveLength(2);
    const deprecated = outcome.violations.find((v) => v.message.includes("deprecated"));
    const placeholder = outcome.violations.find((v) => v.message.includes("placeholder reason"));
    expect(deprecated?.neverFrozen).toBeUndefined();
    expect(placeholder?.neverFrozen).toBe(true);
  });

  test("sibling findings outside root are reported too", () => {
    const sfs = files({
      [`/r/b/${REL_FILE}`]: `
export const a = { access: { openToAll: true } };
`,
    });
    const guard = createOpenToAllReasonGuard({ root: "/r/a" });
    const outcome = guard.run(sfs);
    expect(outcome.violations).toHaveLength(1);
    expect(outcome.violations[0]?.file).toBe(`../b/${REL_FILE}`);
  });
});

describe("applySecurityBaseline end-to-end via createOpenToAllReasonGuard", () => {
  let root: { readonly name: string; readonly absPath: string };
  let guard: ReturnType<typeof createOpenToAllReasonGuard>;
  beforeEach(() => {
    root = {
      name: "framework",
      absPath: mkdtempSync(path.join(tmpdir(), "open-to-all-e2e-")),
    };
    guard = createOpenToAllReasonGuard({ root: root.absPath });
  });
  afterEach(() => {
    rmSync(root.absPath, { recursive: true, force: true });
  });

  const REL_FILE = "packages/bundled-features/src/foo/handlers/x.write.ts";

  function writeSource(code: string): SourceFile {
    const abs = path.join(root.absPath, REL_FILE);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, code);
    return new Project({ skipAddingFilesFromTsConfig: true }).addSourceFileAtPath(abs);
  }

  function loadFrom(perFile: Record<string, number>): (repo: string) => SecurityBaselineLoad {
    return () => ({
      kind: "ok",
      findings: { "Open-To-All-Reason Guard": perFile },
      hardFail: [],
    });
  }

  test("a baseline covering the deprecated finding freezes it (not blocking)", () => {
    const sf = writeSource("export const a = { access: { openToAll: true } };\n");
    const outcome = guard.run([sf]);
    const result = applySecurityBaseline({
      guardName: guard.name,
      violations: outcome.violations,
      roots: [root],
      cwd: root.absPath,
      load: loadFrom({ [REL_FILE]: 1 }),
    });
    expect(result.blocking).toHaveLength(0);
    expect(result.frozen).toBe(1);
  });

  test("growth beyond the baseline blocks", () => {
    const sf = writeSource(`
export const a = { access: { openToAll: true } };
export const b = { access: { openToAll: true } };
`);
    const outcome = guard.run([sf]);
    const result = applySecurityBaseline({
      guardName: guard.name,
      violations: outcome.violations,
      roots: [root],
      cwd: root.absPath,
      load: loadFrom({ [REL_FILE]: 1 }),
    });
    expect(result.blocking.length).toBeGreaterThan(0);
  });

  test("a placeholder reason blocks even when the baseline lists the file with a high count", () => {
    const sf = writeSource('export const a = { access: { openToAll: { reason: "todo" } } };\n');
    const outcome = guard.run([sf]);
    const result = applySecurityBaseline({
      guardName: guard.name,
      violations: outcome.violations,
      roots: [root],
      cwd: root.absPath,
      load: loadFrom({ [REL_FILE]: 100 }),
    });
    expect(result.blocking).toHaveLength(1);
    expect(result.blocking[0]?.message).toMatch(/placeholder reason/);
    expect(result.frozen).toBe(0);
  });
});
