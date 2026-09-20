import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveFrameworkVersion } from "../framework-version";

const tmpRoots: string[] = [];

function makeTree(): { root: string; nested: string } {
  const root = mkdtempSync(join(tmpdir(), "framework-version-"));
  tmpRoots.push(root);
  const nested = join(root, "a", "b");
  mkdirSync(nested, { recursive: true });
  return { root, nested };
}

afterEach(() => {
  for (const root of tmpRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("resolveFrameworkVersion", () => {
  test("resolves the real dev-server version with a caret range", async () => {
    const own: { version: string } = await Bun.file(
      join(import.meta.dir, "../../package.json"),
    ).json();
    expect(resolveFrameworkVersion()).toBe(`^${own.version}`);
  });

  test("skips corrupt and foreign package.json files on the way up", () => {
    const { root, nested } = makeTree();
    writeFileSync(
      join(root, "package.json"),
      '{"name":"@cosmicdrift/kumiko-dev-server","version":"1.2.3"}',
    );
    writeFileSync(join(root, "a", "package.json"), '{"name":"other","version":"9.9.9"}');
    writeFileSync(join(nested, "package.json"), "{ not json");
    expect(resolveFrameworkVersion(nested)).toBe("^1.2.3");
  });

  test("ignores a dev-server manifest without a version", () => {
    const { root, nested } = makeTree();
    writeFileSync(join(root, "package.json"), '{"name":"@cosmicdrift/kumiko-dev-server"}');
    expect(resolveFrameworkVersion(nested)).toBeUndefined();
  });
});
