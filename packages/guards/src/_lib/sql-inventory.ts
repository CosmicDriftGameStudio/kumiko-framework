/**
 * Raw-SQL inventory — shared allowlist + scanner for `guard-raw-sql`.
 * Scans TypeScript sources for escape-hatch patterns (`.unsafe()`,
 * `asRawClient()`, `DELETE FROM`, `.execute()`).
 *
 * Escape hatch for a justified raw-SQL call:
 *   // kumiko-lint-ignore raw-sql <reason>
 * on the call's own line or the line directly above. A bare tag with no
 * reason text after it does NOT suppress the finding.
 *
 * I/O: Bun.Glob + Bun.file; directoryExists uses node:fs (same as roots.ts).
 */
import { existsSync, statSync } from "node:fs";
import { type RepoRoot, sourceRootDirs } from "./roots";

/** POSIX path join without Node path module. */
function joinPath(base: string, ...segments: string[]): string {
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
  /** True when a `kumiko-lint-ignore raw-sql <reason>` marker suppresses this hit. */
  readonly markerSuppressed: boolean;
  readonly snippet: string;
};

export type SqlInventoryReport = {
  readonly scannedAt: string;
  readonly root: string;
  readonly hits: readonly SqlInventoryHit[];
  /** Total files scanned across this repo's scan dirs — feeds the vacuity check. */
  readonly scannedFiles: number;
  readonly summary: {
    readonly total: number;
    readonly disallowed: number;
    readonly byKind: Readonly<Record<SqlInventoryKind, number>>;
    readonly byBucket: {
      readonly allowed: number;
      readonly tests: number;
      readonly marker: number;
      readonly disallowed: number;
    };
  };
};

/** Paths where `.unsafe()` / `asRawClient()` are permitted (Phase 5 guard). */
export const RAW_SQL_ALLOWLIST: ReadonlyArray<RegExp> = [
  // Layout-agnostic: framework packages/... AND flat app src/... AND enterprise packages/<pkg>/...
  /(^|\/)(packages\/[^/]+\/)?src\/db\/queries\//,
  /(^|\/)(packages\/[^/]+\/)?src\/db\/migrate-runner\.ts$/,
  /(^|\/)(packages\/[^/]+\/)?src\/db\/schema-inspection\.ts$/,
  /(^|\/)(packages\/[^/]+\/)?src\/db\/render-ddl\.ts$/,
  /(^|\/)(packages\/[^/]+\/)?src\/bun-db\/query\.ts$/,
  /(^|\/)(packages\/[^/]+\/)?src\/testing\//,
  // ponytail: explicit enumeration — a blanket regex would auto-allow any new .unsafe()
  /\/bundled-features\/src\/billing-foundation\/db\/queries\/subscription-projection\.ts$/,
  /\/bundled-features\/src\/config\/db\/queries\/resolver\.ts$/,
  /\/bundled-features\/src\/custom-fields\/db\/queries\/field-access\.ts$/,
  /\/bundled-features\/src\/custom-fields\/db\/queries\/projection\.ts$/,
  /\/bundled-features\/src\/custom-fields\/db\/queries\/quota\.ts$/,
  /\/bundled-features\/src\/custom-fields\/db\/queries\/retention\.ts$/,
  /\/bundled-features\/src\/custom-fields\/db\/queries\/user-data-rights\.ts$/,
  /\/bundled-features\/src\/delivery\/db\/queries\/preferences\.ts$/,
  /\/bundled-features\/src\/form-draft\/db\/queries\/cleanup\.ts$/,
  /\/bundled-features\/src\/form-draft\/db\/queries\/draft-count\.ts$/,
  /\/bundled-features\/src\/form-draft\/db\/queries\/owned-file-refs\.ts$/,
  /\/bundled-features\/src\/inbound-mail-foundation\/db\/queries\/inbound-projections\.ts$/,
  /\/bundled-features\/src\/secrets\/db\/queries\/read\.ts$/,
  /\/bundled-features\/src\/sessions\/db\/queries\/cleanup\.ts$/,
  /\/bundled-features\/src\/user\/db\/queries\/stream-tenant-backfill\.ts$/,
  /\/packages\/framework\/src\/engine\/steps\/unsafe-projection-/,
  /(^|\/)samples\/(apps|recipes)\/[^/]+\/src\/db\/queries\//,
  /\/bin\/commands\//,
  /\/scripts\/codemod-/,
  /\/__tests__\//,
  /\/bin\/_lib\//,
];

/** Escape-hatch tag. Must be followed by whitespace + a non-empty reason to suppress. */
const MARKER_TAG = "kumiko-lint-ignore raw-sql";
// Marker must appear in a // comment — string literals describing the hatch must not suppress.
const MARKER_WITH_REASON_RE = /(^|\s)\/\/\s*kumiko-lint-ignore raw-sql\s+\S/;

const SKIP_PATH_PARTS = ["/node_modules/", "/dist/", "/.kumiko/"] as const;

const PATTERNS: ReadonlyArray<{
  readonly kind: SqlInventoryKind;
  readonly re: RegExp;
}> = [
  { kind: "unsafe", re: /\.unsafe\s*[<(]/ },
  { kind: "asRawClient", re: /asRawClient\s*\(/ },
  { kind: "delete_from", re: /DELETE\s+FROM/i },
  { kind: "execute", re: /\.execute\s*\(/ },
];

/** Only these kinds fail CI; delete_from/execute stay inventory-only (infra#610). */
export const BLOCKING_SQL_KINDS: ReadonlyArray<SqlInventoryKind> = ["unsafe", "asRawClient"];

const TS_GLOB = new Bun.Glob("**/*.{ts,tsx}");

// kumiko-platform deliberately returns no scan dirs (0 files) — its docs-samples tree needs its own allowlist review before this guard scans it (follow-up issue).
export function sqlScanDirsFor(root: RepoRoot): readonly string[] {
  if (root.name === "kumiko-platform") return [];
  return sourceRootDirs(root).map((dir) => dir.slice(root.absPath.length).replace(/^\/+/, ""));
}

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

function bucketFor(hit: SqlInventoryHit): "allowed" | "tests" | "marker" | "disallowed" {
  if (isTestPath(hit.file)) return "tests";
  if (hit.allowed) return "allowed";
  if (hit.markerSuppressed) return "marker";
  return "disallowed";
}

function shouldSkipRelativePath(rel: string): boolean {
  return SKIP_PATH_PARTS.some((part) => rel.includes(part));
}

function directoryExists(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}

async function collectTsFiles(repoRoot: string, scanDirs: readonly string[]): Promise<string[]> {
  const out: string[] = [];
  for (const sub of scanDirs) {
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

/** Strip a trailing/leading ignore-marker comment out of a reported snippet. */
function stripMarker(trimmed: string): string {
  const idx = trimmed.indexOf(MARKER_TAG);
  if (idx < 0) return trimmed;
  return trimmed.slice(0, idx).trimEnd();
}

function scanFileText(relPath: string, text: string, hits: SqlInventoryHit[]): void {
  const lines = text.split("\n");
  const consumedMarkers = new Set<number>();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();

    // Lookback happens independently of the comment-only-line skip below —
    // a marker placed on its own comment line (the common case: the line
    // ABOVE the offending call) must still be seen even though that line
    // itself never reaches the pattern loop.
    //
    // Documented hatch: marker on the call line or the line directly above.
    // Each marker line suppresses at most one subsequent hit (consumed), so a
    // second `.unsafe()` under the same comment is not silently covered.
    let suppressed = false;
    if (MARKER_WITH_REASON_RE.test(line)) {
      suppressed = true;
    } else if (i > 0 && MARKER_WITH_REASON_RE.test(lines[i - 1] ?? "")) {
      const markerIdx = i - 1;
      if (!consumedMarkers.has(markerIdx)) {
        suppressed = true;
        consumedMarkers.add(markerIdx);
      }
    }

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
        markerSuppressed: suppressed,
        snippet: stripMarker(trimmed).slice(0, 120),
      });
    }
  }
}

export async function scanRepo(
  repoRoot: string,
  scanDirs: readonly string[],
): Promise<SqlInventoryReport> {
  const relFiles = await collectTsFiles(repoRoot, scanDirs);
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
  const byBucket = { allowed: 0, tests: 0, marker: 0, disallowed: 0 };
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
    scannedFiles: relFiles.length,
    summary: {
      total: hits.length,
      disallowed,
      byKind,
      byBucket,
    },
  };
}
