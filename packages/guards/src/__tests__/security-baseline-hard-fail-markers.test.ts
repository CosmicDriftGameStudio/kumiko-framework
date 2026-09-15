import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isSecurityGuard } from "../_lib/guard-kit";
import { parseSecurityBaseline, SECURITY_BASELINE_FILE } from "../_lib/security-baseline";
import { GUARDS } from "../run-guards";

const REPO_ROOT = join(import.meta.dirname, "../../../..");
const BASELINE_PATH = join(REPO_ROOT, SECURITY_BASELINE_FILE);

describe("this repo's own committed security baseline", () => {
  test.skipIf(!existsSync(BASELINE_PATH))(
    "parses and every hardFail entry names a registered security guard",
    () => {
      const securityGuardNames = new Set(GUARDS.filter(isSecurityGuard).map((g) => g.name));
      const parsed = parseSecurityBaseline(JSON.parse(readFileSync(BASELINE_PATH, "utf-8")));
      expect(parsed).toBeDefined();
      for (const guardName of parsed?.hardFail ?? []) {
        expect(securityGuardNames.has(guardName)).toBe(true);
      }
    },
  );
});
