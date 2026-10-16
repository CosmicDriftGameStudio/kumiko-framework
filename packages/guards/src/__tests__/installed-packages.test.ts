import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  collectInstalledPackages,
  installationRoots,
  normalizeLicense,
  workspaceMemberDirs,
} from "../_lib/installed-packages";

const tempDirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "installed-packages-"));
  tempDirs.push(realpathSync(dir));
  return realpathSync(dir);
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function writeJson(file: string, value: unknown): void {
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, JSON.stringify(value), "utf-8");
}

function install(nodeModulesParent: string, name: string, pkg: Record<string, unknown> = {}): void {
  writeJson(join(nodeModulesParent, "node_modules", name, "package.json"), {
    name,
    version: "1.0.0",
    license: "MIT",
    ...pkg,
  });
}

function names(repoRoot: string): string[] {
  return collectInstalledPackages(repoRoot).map((p) => p.name);
}

describe("collectInstalledPackages", () => {
  test("standalone layout: node_modules in the repo root", () => {
    const repo = tempDir();
    writeJson(join(repo, "package.json"), { name: "repo" });
    install(repo, "left-pad");
    install(repo, "@scope/thing");
    expect(names(repo)).toEqual(["@scope/thing", "left-pad"]);
  });

  test("parent layout: node_modules exist only in an ancestor of the repo (worktree under .wt)", () => {
    const parent = tempDir();
    const repo = join(parent, "repo", ".wt", "feature");
    writeJson(join(repo, "package.json"), { name: "repo" });
    install(parent, "hoisted-dep");
    expect(names(repo)).toEqual(["hoisted-dep"]);
  });

  test("workspace members' node_modules are read, undeclared siblings' are not", () => {
    const repo = tempDir();
    writeJson(join(repo, "package.json"), { name: "repo", workspaces: ["packages/*"] });
    writeJson(join(repo, "packages", "a", "package.json"), { name: "a", version: "0.0.0" });
    install(join(repo, "packages", "a"), "member-dep");
    install(join(repo, "other", "b"), "foreign-dep");
    expect(names(repo)).toEqual(["member-dep"]);
  });

  test("workspaces in the object form are resolved", () => {
    const repo = tempDir();
    writeJson(join(repo, "package.json"), { name: "repo", workspaces: { packages: ["apps/*"] } });
    writeJson(join(repo, "apps", "web", "package.json"), { name: "web", version: "0.0.0" });
    expect(workspaceMemberDirs(repo)).toEqual([join(repo, "apps", "web")]);
  });

  test("first-party and private packages are not third-party licences", () => {
    const repo = tempDir();
    writeJson(join(repo, "package.json"), { name: "repo" });
    install(repo, "@cosmicdrift/kumiko-framework");
    install(repo, "internal-app", { private: true });
    install(repo, "third-party");
    expect(names(repo)).toEqual(["third-party"]);
  });

  test("no node_modules anywhere yields an empty list (callers must fail loudly)", () => {
    const repo = tempDir();
    writeJson(join(repo, "package.json"), { name: "repo" });
    // The temp dir's own ancestors (/tmp, /) hold no node_modules.
    expect(collectInstalledPackages(repo)).toEqual([]);
  });

  test("the same name@version found twice is reported once", () => {
    const parent = tempDir();
    const repo = join(parent, "repo");
    writeJson(join(repo, "package.json"), { name: "repo" });
    install(parent, "dup");
    install(repo, "dup");
    expect(names(repo)).toEqual(["dup"]);
  });
});

describe("installationRoots", () => {
  test("lists the repo root and every ancestor that has a node_modules", () => {
    const parent = tempDir();
    const repo = join(parent, "repo");
    writeJson(join(repo, "package.json"), { name: "repo" });
    install(parent, "x");
    expect(installationRoots(repo)).toEqual([repo, parent]);
  });
});

describe("normalizeLicense", () => {
  test("string, {type}, legacy array and missing", () => {
    expect(normalizeLicense(" MIT ")).toBe("MIT");
    expect(normalizeLicense({ type: "ISC" })).toBe("ISC");
    expect(normalizeLicense([{ type: "MIT" }, "Apache-2.0"])).toBe("(MIT OR Apache-2.0)");
    expect(normalizeLicense([{ type: "MIT" }])).toBe("MIT");
    expect(normalizeLicense(undefined)).toBeNull();
    expect(normalizeLicense("")).toBeNull();
  });
});
