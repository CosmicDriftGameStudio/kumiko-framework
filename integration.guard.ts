// Guard: integration tests must not use mocks (real HTTP/DB only).
// Run via: bun integration.guard.ts

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import {
  hasDisallowedMock,
  isMockGuardAllowlisted,
} from "./bin/_lib/integration-mock-guard.ts";

// baseDir determines allowlist-relative paths — process.cwd() in the guard
// run; tests pass their temp dir so walk + allowlist stay cwd-independent.
export function scanForMocks(dir: string, baseDir: string = process.cwd()): string[] {
  const violations: string[] = [];
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory() && entry.name !== "node_modules" && entry.name !== "dist") {
        violations.push(...scanForMocks(fullPath, baseDir));
      } else if (
        entry.name.endsWith(".integration.test.ts") ||
        entry.name.endsWith(".integration.ts")
      ) {
        const relPath = relative(baseDir, fullPath);
        if (isMockGuardAllowlisted(relPath)) continue;
        const content = readFileSync(fullPath, "utf-8");
        if (hasDisallowedMock(content)) {
          violations.push(relPath);
        }
      }
    }
  } catch {
    // skip unreadable dirs
  }
  return violations;
}

if (import.meta.main) {
  const violations: string[] = [];
  for (const root of ["packages", "samples"]) {
    violations.push(...scanForMocks(join(process.cwd(), root)));
  }

  if (violations.length > 0) {
    console.error("\n  BLOCKED: Integration tests must NOT use mocks:\n");
    for (const v of violations) {
      console.error(`    ${v}`);
    }
    console.error("\n  Move mock-based tests to *.test.ts files.\n");
    process.exit(1);
  }

  console.log("  Integration guard: no mocks found in integration test files");
}
