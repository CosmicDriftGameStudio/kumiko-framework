import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  integrationShardFromArgv,
  parseIntegrationShard,
  selectShardFiles,
  shardRunsSubprocessLane,
  SUBPROCESS_INTEGRATION_FILES,
} from "../integration-test";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");

describe("SUBPROCESS_INTEGRATION_FILES", () => {
  test("lists only files that exist, so a rename cannot silently move them back into the parallel lane", () => {
    const missing = [...SUBPROCESS_INTEGRATION_FILES].filter(
      (file) => !existsSync(join(REPO_ROOT, file)),
    );
    expect(missing).toEqual([]);
  });
});

describe("integration shards", () => {
  test("parses N/M and rejects malformed or out-of-range values", () => {
    expect(parseIntegrationShard("2/3")).toEqual({ index: 2, total: 3 });
    for (const bad of ["0/2", "3/2", "1", "a/b", "1/0", "1/2/3", ""]) {
      expect(() => parseIntegrationShard(bad)).toThrow(/Invalid shard/);
    }
  });

  test("reads the flag from argv, null without it", () => {
    expect(integrationShardFromArgv(["bun", "run.ts", "--shard=1/2"])).toEqual({ index: 1, total: 2 });
    expect(integrationShardFromArgv(["bun", "run.ts", "--perf"])).toBeNull();
  });

  test("shards partition the files: disjoint, complete, deterministic regardless of input order", () => {
    const files = ["d.ts", "a.ts", "e.ts", "c.ts", "b.ts"];
    const slices = [1, 2, 3].map((index) => selectShardFiles(files, { index, total: 3 }));

    expect(slices.flat().sort()).toEqual([...files].sort());
    expect(slices).toEqual([
      ["a.ts", "d.ts"],
      ["b.ts", "e.ts"],
      ["c.ts"],
    ]);
    expect(selectShardFiles([...files].reverse(), { index: 1, total: 3 })).toEqual(slices[0]);
  });

  test("only the first shard (or an unsharded run) owns the subprocess lane", () => {
    expect(shardRunsSubprocessLane(null)).toBe(true);
    expect(shardRunsSubprocessLane({ index: 1, total: 2 })).toBe(true);
    expect(shardRunsSubprocessLane({ index: 2, total: 2 })).toBe(false);
  });
});
