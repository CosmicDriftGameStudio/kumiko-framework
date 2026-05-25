#!/usr/bin/env bun
/**
 * Rewrites standalone bun-db helper calls on ctx.db to TenantDb methods so
 * tenant scoping (filter on read, tenantId injection on insert) stays intact.
 *
 *   insertOne(ctx.db, table, values)  → ctx.db.insertOne(table, values)
 *   fetchOne(ctx.db, table, where)    → ctx.db.fetchOne(table, where)
 *   selectMany(ctx.db, ...)           → ctx.db.selectMany(...)
 *   updateMany(ctx.db, ...)           → ctx.db.updateMany(...)
 *   deleteMany(ctx.db, ...)           → ctx.db.deleteMany(...)
 *
 * ONLY safe when ctx.db is TenantDb (write/query handlers, projections with
 * tenant-scoped tx). Do NOT apply to:
 *   - UserDataHookCtx.db (DbRunner) — use standalone helpers
 *   - EventUpcastCtx.db (DbRunner) — use standalone helpers
 *   - stack.db in tests — raw DbConnection, standalone helpers are correct
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOTS = [
  "samples",
  "packages/bundled-features/src",
  "packages/framework/src",
];

const HELPERS = ["insertOne", "fetchOne", "selectMany", "updateMany", "deleteMany"] as const;
const PATTERN = new RegExp(
  `\\b(${HELPERS.join("|")})(?:<[^>]+>)?\\(\\s*ctx\\.db\\s*,`,
  "g",
);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      if (name === "node_modules" || name === "dist") continue;
      walk(path, out);
    } else if (name.endsWith(".ts") && !name.endsWith(".d.ts")) {
      out.push(path);
    }
  }
  return out;
}

let changed = 0;
for (const root of ROOTS) {
  for (const file of walk(root)) {
    const before = readFileSync(file, "utf8");
    const after = before.replace(PATTERN, "ctx.db.$1(");
    if (after !== before) {
      writeFileSync(file, after);
      changed += 1;
      console.log(file);
    }
  }
}

console.log(`Updated ${changed} file(s).`);
