// Guard: integration tests must not use mocks (real HTTP/DB only).
// Run via: bun integration.guard.js

const { readdirSync, readFileSync } = require("node:fs");
const { join, relative } = require("node:path");
const { hasDisallowedMock, isMockGuardAllowlisted } = require("./bin/_lib/integration-mock-guard.ts");

function scanForMocks(dir) {
  const violations = [];
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory() && entry.name !== "node_modules" && entry.name !== "dist") {
        violations.push(...scanForMocks(fullPath));
      } else if (
        entry.name.endsWith(".integration.test.ts") ||
        entry.name.endsWith(".integration.ts")
      ) {
        const relPath = relative(process.cwd(), fullPath);
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

const violations = [];
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
