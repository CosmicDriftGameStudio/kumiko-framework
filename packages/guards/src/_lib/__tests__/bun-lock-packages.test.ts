import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readLockfilePackages } from "../bun-lock-packages";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs.length = 0;
});

function repoWithLock(content: string | undefined): string {
  const dir = mkdtempSync(join(tmpdir(), "bun-lock-packages-"));
  dirs.push(dir);
  if (content !== undefined) writeFileSync(join(dir, "bun.lock"), content, "utf-8");
  return dir;
}

describe("readLockfilePackages", () => {
  test("returns undefined without a bun.lock", () => {
    expect(readLockfilePackages(repoWithLock(undefined))).toBeUndefined();
  });

  test("reads lockKey, name and version, including scoped and nested entries", () => {
    const lock = `{
  "lockfileVersion": 1,
  "packages": {
    "@cosmicdrift/kumiko-framework": ["@cosmicdrift/kumiko-framework@0.323.0", "", {}, "sha"],
    "@cosmicdrift/kumiko-cli/@cosmicdrift/kumiko-framework": ["@cosmicdrift/kumiko-framework@0.285.0", "", {}],
    "left-pad": ["left-pad@1.3.0", "", {}],
  }
}`;
    const result = readLockfilePackages(repoWithLock(lock));
    expect(result).toEqual({
      ok: true,
      packages: [
        {
          lockKey: "@cosmicdrift/kumiko-framework",
          name: "@cosmicdrift/kumiko-framework",
          version: "0.323.0",
          line: 4,
        },
        {
          lockKey: "@cosmicdrift/kumiko-cli/@cosmicdrift/kumiko-framework",
          name: "@cosmicdrift/kumiko-framework",
          version: "0.285.0",
          line: 5,
        },
        { lockKey: "left-pad", name: "left-pad", version: "1.3.0", line: 6 },
      ],
    });
  });

  test("keeps workspace: versions as-is", () => {
    const lock = `{"packages":{"@cosmicdrift/kumiko-framework":["@cosmicdrift/kumiko-framework@workspace:packages/framework"]}}`;
    const result = readLockfilePackages(repoWithLock(lock));
    expect(result).toMatchObject({
      ok: true,
      packages: [{ version: "workspace:packages/framework" }],
    });
  });

  test("a lockfile without a packages key yields an empty list", () => {
    expect(readLockfilePackages(repoWithLock("{}"))).toEqual({ ok: true, packages: [] });
  });

  test("an unparsable lockfile fails closed", () => {
    expect(readLockfilePackages(repoWithLock("{ not json"))?.ok).toBe(false);
  });

  test("an entry not readable as name@version fails the whole lockfile closed", () => {
    const lock = `{"packages":{"good":["good@1.0.0"],"bad":["no-version-here"]}}`;
    expect(readLockfilePackages(repoWithLock(lock))?.ok).toBe(false);
  });

  test("a non-tuple entry fails closed", () => {
    expect(readLockfilePackages(repoWithLock(`{"packages":{"x":"nope"}}`))?.ok).toBe(false);
  });
});
