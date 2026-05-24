/**
 * Raw-SQL inventory — shared allowlist for `kumiko sql-inventory` and
 * `guard-raw-sql` (Phase 5). Scans TypeScript sources for escape-hatch patterns.
 *
 * Bun-only I/O: Bun.Glob + Bun.file (no node:fs, no node:path).
 */

/** POSIX path join without Node path module. */
export function joinPath(base: string, ...segments: string[]): string {
  return [base, ...segments]
    .join("/")
    .replace(/\/+/g, "/")
    .replace(/\/\.\//g, "/");
}

export type SqlInventoryKind = "unsafe" | "asRawClient" | "delete_from" | "execute";

export type SqlInventoryHit = {
  readonly file: string;
  readonly line: number;
  readonly kind: SqlInventoryKind;
  readonly allowed: boolean;
  readonly snippet: string;
};

export type SqlInventoryReport = {
  readonly scannedAt: string;
  readonly root: string;
  readonly hits: readonly SqlInventoryHit[];
  readonly summary: {
    readonly total: number;
    readonly disallowed: number;
    readonly byKind: Readonly<Record<SqlInventoryKind, number>>;
    readonly byBucket: {
      readonly allowed: number;
      readonly tests: number;
      readonly disallowed: number;
    };
  };
};

/** Paths where `.unsafe()` / `asRawClient()` are permitted (Phase 5 guard). */
export const RAW_SQL_ALLOWLIST: ReadonlyArray<RegExp> = [
  /\/packages\/framework\/src\/db\/queries\//,
  /\/packages\/framework\/src\/db\/migrate-runner\.ts$/,
  /\/packages\/framework\/src\/db\/schema-inspection\.ts$/,
  /\/packages\/framework\/src\/db\/render-ddl\.ts$/,
  /\/packages\/framework\/src\/db\/sql-inventory\.ts$/,
  /\/packages\/framework\/src\/bun-db\/query\.ts$/,
  /\/packages\/framework\/src\/testing\//,
  /\/packages\/bundled-features\/src\/[^/]+\/db\/queries\//,
  /\/packages\/framework\/src\/engine\/steps\/unsafe-projection-/,
  /\/samples\/(apps|recipes)\/[^/]+\/src\/db\/queries\//,
  /\/bin\/commands\//,
  /\/scripts\/codemod-/,
  /\/__tests__\//,
  /\/scripts\/sql-inventory\.ts$/,
  /\/bin\/_lib\//,
];

const SCAN_DIRS = ["packages", "samples", "scripts", "bin"] as const;

const SKIP_PATH_PARTS = ["/node_modules/", "/dist/", "/.kumiko/"] as const;

const PATTERNS: ReadonlyArray<{ readonly kind: SqlInventoryKind; readonly re: RegExp }> = [
  { kind: "unsafe", re: /\.unsafe\s*\(/ },
  { kind: "asRawClient", re: /asRawClient\s*\(/ },
  { kind: "delete_from", re: /DELETE\s+FROM/i },
  { kind: "execute", re: /\.execute\s*\(/ },
];

const TS_GLOB = new Bun.Glob("**/*.{ts,tsx}");

function normalizePathForMatch(filePath: string): string {
  return filePath.startsWith("/") ? filePath : `/${filePath}`;
}

export function isRawSqlAllowed(filePath: string): boolean {
  const normalized = normalizePathForMatch(filePath);
  return RAW_SQL_ALLOWLIST.some((re) => re.test(normalized));
}

function isTestPath(filePath: string): boolean {
  return /\/__tests__\//.test(normalizePathForMatch(filePath));
}

function bucketFor(hit: SqlInventoryHit): "allowed" | "tests" | "disallowed" {
  if (isTestPath(hit.file)) return "tests";
  if (hit.allowed) return "allowed";
  return "disallowed";
}

function shouldSkipRelativePath(rel: string): boolean {
  return SKIP_PATH_PARTS.some((part) => rel.includes(part));
}

function directoryExists(path: string): boolean {
  return Bun.spawnSync(["test", "-d", path]).exitCode === 0;
}

async function collectTsFiles(repoRoot: string): Promise<string[]> {
  const out: string[] = [];
  for (const sub of SCAN_DIRS) {
    const cwd = joinPath(repoRoot, sub);
    if (!directoryExists(cwd)) continue;
    for await (const rel of TS_GLOB.scan({ cwd, onlyFiles: true })) {
      const normalized = rel.replace(/\0/g, "");
      if (!normalized || shouldSkipRelativePath(normalized)) continue;
      out.push(joinPath(sub, normalized));
    }
  }
  return out;
}

function scanFileText(relPath: string, text: string, hits: SqlInventoryHit[]): void {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();
    if (
      trimmed.startsWith("//") ||
      trimmed.startsWith("*") ||
      trimmed.startsWith("/**") ||
      trimmed.startsWith("/*")
    ) {
      continue;
    }
    for (const { kind, re } of PATTERNS) {
      if (!re.test(line)) continue;
      hits.push({
        file: relPath,
        line: i + 1,
        kind,
        allowed: isRawSqlAllowed(relPath),
        snippet: trimmed.slice(0, 120),
      });
    }
  }
}

export async function scanRepo(repoRoot: string): Promise<SqlInventoryReport> {
  const relFiles = await collectTsFiles(repoRoot);
  const hits: SqlInventoryHit[] = [];

  for (const rel of relFiles) {
    const abs = joinPath(repoRoot, rel);
    const text = await Bun.file(abs).text();
    scanFileText(rel, text, hits);
  }

  const byKind: Record<SqlInventoryKind, number> = {
    unsafe: 0,
    asRawClient: 0,
    delete_from: 0,
    execute: 0,
  };
  let disallowed = 0;
  const byBucket = { allowed: 0, tests: 0, disallowed: 0 };
  for (const h of hits) {
    byKind[h.kind]++;
    const b = bucketFor(h);
    byBucket[b]++;
    if (b === "disallowed") disallowed++;
  }

  return {
    scannedAt: new Date().toISOString(),
    root: repoRoot,
    hits,
    summary: {
      total: hits.length,
      disallowed,
      byKind,
      byBucket,
    },
  };
}

export function formatReport(report: SqlInventoryReport): string {
  const lines: string[] = [
    "--- sql inventory ---",
    `  scanned:   ${report.scannedAt}`,
    `  root:      ${report.root}`,
    `  total:     ${report.summary.total}`,
    `  allowed:   ${report.summary.byBucket.allowed}`,
    `  tests:     ${report.summary.byBucket.tests}`,
    `  disallowed:${report.summary.disallowed}`,
    `  unsafe:    ${report.summary.byKind.unsafe}`,
    `  asRawClient:${report.summary.byKind.asRawClient}`,
    `  DELETE FROM strings: ${report.summary.byKind.delete_from}`,
    `  .execute:  ${report.summary.byKind.execute}`,
    "---",
  ];

  const bad = report.hits.filter((h) => bucketFor(h) === "disallowed");
  if (bad.length === 0) {
    lines.push("  (no disallowed production hits)");
  } else {
    lines.push("  disallowed (production):");
    for (const h of bad.slice(0, 40)) {
      lines.push(`    ${h.kind.padEnd(12)} ${h.file}:${h.line}  ${h.snippet}`);
    }
    if (bad.length > 40) {
      lines.push(`    … +${bad.length - 40} more`);
    }
  }
  return lines.join("\n");
}
