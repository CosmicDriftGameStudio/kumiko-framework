// Guard: integration tests must not use mocks
// Run via: node vitest.integration.guard.js

const { readdirSync, readFileSync } = require("node:fs");
const { join } = require("node:path");

function scanForMocks(dir) {
  const violations = [];
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory() && entry.name !== "node_modules") {
        violations.push(...scanForMocks(fullPath));
      } else if (entry.name.endsWith(".integration.ts")) {
        const content = readFileSync(fullPath, "utf-8");
        if (/vi\.(mock|fn|spyOn)\s*\(/.test(content)) {
          violations.push(fullPath);
        }
      }
    }
  } catch {
    // skip
  }
  return violations;
}

const violations = scanForMocks(join(process.cwd(), "packages"));

if (violations.length > 0) {
  console.error("\n  BLOCKED: Integration tests must NOT use mocks:\n");
  for (const v of violations) {
    console.error(`    ${v}`);
  }
  console.error("\n  Move mock-based tests to *.test.ts files.\n");
  process.exit(1);
}

console.log("  Integration guard: no mocks found in *.integration.ts files");
