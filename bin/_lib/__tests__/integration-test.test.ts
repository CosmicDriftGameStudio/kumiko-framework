import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { SUBPROCESS_INTEGRATION_FILES } from "../integration-test";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");

describe("SUBPROCESS_INTEGRATION_FILES", () => {
  test("lists only files that exist, so a rename cannot silently move them back into the parallel lane", () => {
    const missing = [...SUBPROCESS_INTEGRATION_FILES].filter(
      (file) => !existsSync(join(REPO_ROOT, file)),
    );
    expect(missing).toEqual([]);
  });
});
