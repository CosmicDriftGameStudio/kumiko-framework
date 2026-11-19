import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { CHECK_PIPELINE_BIN } from "../commands/_spawn";

const repoRoot = join(import.meta.dir, "..", "..");
const pipelineEntry = join(repoRoot, CHECK_PIPELINE_BIN);

describe("check pipeline entry", () => {
  test("the path the check commands spawn exists", () => {
    expect(existsSync(pipelineEntry)).toBe(true);
  });

  test("an unknown step set exits 1 and lists the valid ones", () => {
    const result = Bun.spawnSync([process.execPath, pipelineEntry, "dev"], { cwd: repoRoot });
    const stderr = result.stderr.toString();
    expect(result.exitCode).toBe(1);
    expect(stderr).toContain('unknown step set "dev"');
    expect(stderr).toContain("check, check:fast, ci:guards");
  });

  test("a missing step set exits 1", () => {
    const result = Bun.spawnSync([process.execPath, pipelineEntry], { cwd: repoRoot });
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("unknown step set");
  });
});
