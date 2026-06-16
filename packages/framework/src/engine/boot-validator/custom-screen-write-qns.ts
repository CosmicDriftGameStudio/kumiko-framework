import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  extractDispatcherWriteQnsFromSource,
  validateDispatcherWriteQn,
} from "../write-handler-qn-extract";

const SKIP_SEGMENTS = new Set(["node_modules", ".kumiko", "dist", "dist-server", "__tests__"]);

function collectAppSourceFiles(dir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    // skip: directory unreadable (permissions / race) — treat as empty
    return;
  }
  for (const entry of entries) {
    if (entry.startsWith(".")) continue;
    if (SKIP_SEGMENTS.has(entry)) continue;
    const full = join(dir, entry);
    let stat: ReturnType<typeof statSync>;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      collectAppSourceFiles(full, out);
    } else if (
      stat.isFile() &&
      (entry.endsWith(".ts") || entry.endsWith(".tsx")) &&
      !entry.endsWith(".d.ts") &&
      !entry.endsWith(".test.ts") &&
      !entry.endsWith(".test.tsx") &&
      !entry.endsWith(".integration.ts") &&
      !entry.endsWith(".integration.tsx")
    ) {
      out.push(full);
    }
  }
}

/**
 * Boot-time scan of app `src/**` for `dispatcher.write("…")` string literals.
 * Fails fast before the first Custom-Screen click would 404.
 *
 * Only covers string literals — Handler-constant refs are caught by the CI
 * guard (ts-morph) and compile-time TypedDispatcher.
 */
export function validateAppCustomScreenWriteQns(
  appRoot: string,
  knownQns: ReadonlySet<string>,
): void {
  const srcDir = join(appRoot, "src");
  // skip: apps without a src/ tree (server-only packages) — nothing to scan
  if (!existsSync(srcDir)) return;

  const files: string[] = [];
  collectAppSourceFiles(srcDir, files);

  const violations: Array<{ readonly file: string; readonly qn: string; readonly reason: string }> =
    [];

  for (const filePath of files) {
    const source = readFileSync(filePath, "utf-8");
    for (const qn of extractDispatcherWriteQnsFromSource(source)) {
      const result = validateDispatcherWriteQn(qn, knownQns);
      if (!result.ok) {
        violations.push({
          file: relative(appRoot, filePath),
          qn,
          reason: result.reason,
        });
      }
    }
  }

  // skip: no invalid QNs found — boot continues
  if (violations.length === 0) return;

  const lines = violations.map((v) => `  - ${v.file}: "${v.qn}" — ${v.reason}`);
  throw new Error(
    `[kumiko:boot] ${violations.length} invalid dispatcher.write QN(s) in app source:\n${lines.join("\n")}\n` +
      `  Check spelling against registered write handlers (expected "<feature>:write:<handler>").`,
  );
}
