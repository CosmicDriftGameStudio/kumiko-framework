import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  findInstalledPackageDir,
  packageNameOf,
  resolveInstalledSync,
} from "../resolve-installed-package.ts";

let root = "";

function installPackage(baseDir: string, name: string): string {
  const dir = join(baseDir, "node_modules", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), "{}");
  return dir;
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "kumiko-installed-pkg-")));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("packageNameOf", () => {
  test("keeps scope and name, drops the subpath", () => {
    expect(packageNameOf("@scope/pkg/dist/file.css")).toBe("@scope/pkg");
    expect(packageNameOf("@scope/pkg")).toBe("@scope/pkg");
    expect(packageNameOf("pkg/sub/file.js")).toBe("pkg");
    expect(packageNameOf("pkg")).toBe("pkg");
  });
});

describe("findInstalledPackageDir", () => {
  test("finds scoped and unscoped packages in an ancestor node_modules", () => {
    const scoped = installPackage(root, "@scope/pkg");
    const plain = installPackage(root, "plain");
    const from = join(root, "packages/app/src");
    mkdirSync(from, { recursive: true });
    expect(findInstalledPackageDir("@scope/pkg", from)).toBe(scoped);
    expect(findInstalledPackageDir("plain", from)).toBe(plain);
  });

  test("returns the real path of a symlinked entry", () => {
    const real = join(root, "store/pkg-1.0.0");
    mkdirSync(real, { recursive: true });
    writeFileSync(join(real, "package.json"), "{}");
    mkdirSync(join(root, "node_modules"), { recursive: true });
    symlinkSync(real, join(root, "node_modules/pkg"));
    expect(findInstalledPackageDir("pkg", root)).toBe(real);
  });

  test("no node_modules tree → undefined", () => {
    expect(findInstalledPackageDir("@scope/missing", root)).toBeUndefined();
  });
});

describe("resolveInstalledSync", () => {
  function countingResolver(result: string) {
    const calls: Array<{ id: string; from: string }> = [];
    return {
      calls,
      resolveSync: (id: string, from: string) => {
        calls.push({ id, from });
        return result;
      },
    };
  }

  test("does not call the resolver for a package that is not installed", () => {
    const bun = countingResolver("/bun-cache/pkg/index.js");
    expect(resolveInstalledSync("pkg/file.css", root, bun)).toBeUndefined();
    expect(bun.calls).toEqual([]);
  });

  test("passes the resolver result through for an installed package", () => {
    installPackage(root, "@scope/pkg");
    const bun = countingResolver("/resolved/by/bun.css");
    expect(resolveInstalledSync("@scope/pkg/file.css", root, bun)).toBe("/resolved/by/bun.css");
    expect(bun.calls).toEqual([{ id: "@scope/pkg/file.css", from: root }]);
  });

  test("resolver throw → undefined", () => {
    installPackage(root, "pkg");
    const bun = {
      resolveSync: () => {
        throw new Error("no such export");
      },
    };
    expect(resolveInstalledSync("pkg", root, bun)).toBeUndefined();
  });

  test("without a resolver → undefined", () => {
    installPackage(root, "pkg");
    expect(resolveInstalledSync("pkg", root, undefined)).toBeUndefined();
  });
});
