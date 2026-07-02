// Codemod: migrate integration tests from postgres-js to Bun.SQL.
// Text-based — die Muster sind mechanisch genug.
//
// Usage: bun run scripts/codemod-bun-db-integration.ts

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const FRAMEWORK_SRC = join(import.meta.dirname, "..", "src");

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else if (entry.name.endsWith(".integration.ts")) {
      yield full;
    }
  }
}

function sameDepthPrefix(filePath: string): string {
  const rel = relative(FRAMEWORK_SRC, filePath);
  const depth = rel.split("/").length - 1;
  if (depth <= 1) return "..";
  return "../..";
}

// Import-Splitter: entfernt named-imports aus einer import-declaration.
// Returns { rest, removed }.
function splitImport(line: string, toRemove: string[]): { rest: string; removed: string[] } {
  const match = line.match(
    /^import\s+(type\s+)?\{\s*([^}]+)\s*\}\s+from\s+["']([^"']+)["']\s*;?\s*$/,
  );
  if (!match) return { rest: line, removed: [] };

  const isTypeOnly = !!match[1];
  const body = match[2] ?? "";
  const specifier = match[3] ?? "";
  const items = body
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const remaining: string[] = [];
  const removed: string[] = [];

  for (const item of items) {
    const name = item.replace(/^type\s+/, "").trim();
    if (toRemove.includes(name)) {
      removed.push(name);
    } else {
      remaining.push(item);
    }
  }

  if (remaining.length === 0) {
    return { rest: "", removed };
  }

  const prefix =
    isTypeOnly && remaining.every((i) => i.startsWith("type ")) ? "import type { " : "import { ";
  return {
    rest: `${prefix}${remaining.join(", ")} } from "${specifier}";`,
    removed,
  };
}

let changed = 0;
let skipped = 0;

for (const filePath of walk(FRAMEWORK_SRC)) {
  let code = readFileSync(filePath, "utf-8");
  const rel = relative(FRAMEWORK_SRC, filePath);
  let modified = false;
  const notes: string[] = [];

  // --- Determine import paths ---
  const prefix = sameDepthPrefix(filePath);

  // --- Pattern 1: setupTestStack + type TestStack ---
  const hasStackImport = code.includes(`from "${prefix}/stack"`);
  if (!hasStackImport) {
    skipped++;
    continue;
  }

  const hasSetup = /\bsetupTestStack\b/.test(code);
  const hasTestStackType = /\bTestStack\b/.test(code);

  // Skip .client.listen files
  if (/\.client\.listen|\.listen\(/.test(code)) {
    console.log(`  SKIP (LISTEN): ${rel}`);
    skipped++;
    continue;
  }

  // --- Split imports ---
  const lines = code.split("\n");
  const newLines: string[] = [];

  for (const line of lines) {
    let processed = false;

    // Match: import { ..., setupTestStack, ..., type TestStack, ... } from "${prefix}/stack"
    if (line.includes(`from "${prefix}/stack"`)) {
      const toRemove: string[] = [];
      if (hasSetup) toRemove.push("setupTestStack");
      if (hasTestStackType) toRemove.push("type TestStack", "TestStack");

      const { rest, removed } = splitImport(line, toRemove);
      if (removed.length > 0) {
        if (rest) newLines.push(rest);
        processed = true;
        modified = true;

        // Add bun-test-stack import
        if (removed.some((r) => r === "setupTestStack" || r === "TestStack")) {
          const isTestStackType = removed.includes("TestStack");
          const importLine = isTestStackType
            ? `import { setupBunTestStack, type BunTestStack } from "${prefix}/bun-db/__tests__/bun-test-stack";`
            : `import { setupBunTestStack } from "${prefix}/bun-db/__tests__/bun-test-stack";`;
          newLines.push(importLine);
          notes.push("setupTestStack→setupBunTestStack");
        }
      }
    }

    if (!processed) {
      newLines.push(line);
    }
  }

  code = newLines.join("\n");

  // --- Pattern 2: creatTestDb + type TestDb (separate import) ---
  // This needs a second pass on the original lines
  const hasCreateImport = new RegExp(
    `createTestDb.*from "${prefix}/stack"|TestDb.*from "${prefix}/stack"`,
  ).test(code);

  if (hasCreateImport) {
    const lines2 = code.split("\n");
    const newLines2: string[] = [];
    for (const line of lines2) {
      let processed = false;
      if (line.includes(`from "${prefix}/stack"`)) {
        const toRemove: string[] = [];
        if (/\bcreateTestDb\b/.test(code)) toRemove.push("createTestDb");
        if (/\bTestDb\b/.test(code)) toRemove.push("type TestDb", "TestDb");

        const { rest, removed } = splitImport(line, toRemove);
        if (
          removed.length > 0 &&
          (removed.includes("createTestDb") || removed.includes("TestDb"))
        ) {
          if (rest) newLines2.push(rest);
          processed = true;
          modified = true;

          // Add bun-test-db import
          const isBunTestDbType = removed.includes("TestDb");
          const importLine = isBunTestDbType
            ? `import { createBunTestDb, type BunTestDb } from "${prefix}/bun-db/__tests__/bun-test-db";`
            : `import { createBunTestDb } from "${prefix}/bun-db/__tests__/bun-test-db";`;
          newLines2.push(importLine);
          notes.push("createTestDb→createBunTestDb");
        }
      }
      if (!processed) newLines2.push(line);
    }
    code = newLines2.join("\n");
  }

  if (!modified) {
    skipped++;
    continue;
  }

  // --- Replace identifier references ---
  // setupTestStack → setupBunTestStack (in calls, not just import)
  code = code.replace(/\bsetupTestStack\b/g, "setupBunTestStack");

  // TestStack → BunTestStack (as type annotation)
  code = code.replace(/\bTestStack\b/g, "BunTestStack");

  // createTestDb → createBunTestDb (in calls)
  code = code.replace(/\bcreateTestDb\b/g, "createBunTestDb");

  // TestDb → BunTestDb (as type annotation)
  code = code.replace(/\bTestDb\b/g, "BunTestDb");

  // --- Add ensureTemporalPolyfill() before createBunTestDb() calls ---
  if (code.includes("createBunTestDb(")) {
    // Check if polyfill is already imported
    const hasPolyfillImport = code.includes('ensureTemporalPolyfill"');
    if (!hasPolyfillImport) {
      // Add import as first import or after last bun-db import
      const polyfillImport = `import { ensureTemporalPolyfill } from "${prefix}/time/polyfill";`;
      // Insert after the last bun-related import
      const bunDbMarker = `${prefix}/bun-db/__tests__/bun-test-db`;
      const lastBunImportIdx = code.lastIndexOf(bunDbMarker);
      if (lastBunImportIdx >= 0) {
        const insertAt = code.indexOf("\n", lastBunImportIdx) + 1;
        code = `${code.slice(0, insertAt)}${polyfillImport}\n${code.slice(insertAt)}`;
      } else {
        // Insert after first import block
        const firstImportEnd = code.indexOf(";\n");
        if (firstImportEnd >= 0) {
          code = `${code.slice(0, firstImportEnd + 2)}${polyfillImport}\n${code.slice(firstImportEnd + 2)}`;
        }
      }
      notes.push("+ensureTemporalPolyfill");
    }

    // Insert ensureTemporalPolyfill() call before createBunTestDb in beforeAll
    // We need to find `testDb = await createBunTestDb(` pattern
    code = code.replace(
      /(testDb|bun|db)\s*=\s*await\s+createBunTestDb\(/g,
      "await ensureTemporalPolyfill();\n  $1 = await createBunTestDb(",
    );
  }

  // --- Write back ---
  writeFileSync(filePath, code);
  console.log(`  EDITED ${rel}: ${notes.join(", ")}`);
  changed++;
}

console.log(`\nDone: ${changed} files edited, ${skipped} skipped`);
