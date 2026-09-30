import { readFileSync } from "node:fs";
import { join } from "node:path";

export type LockPackage = {
  /** Key inside the lockfile's `packages` object; nested copies carry their parent path. */
  readonly lockKey: string;
  readonly name: string;
  readonly version: string;
  /** 1-based line of the key in bun.lock, 1 when it cannot be located. */
  readonly line: number;
};

export type LockfileRead =
  | { readonly ok: true; readonly packages: readonly LockPackage[] }
  | { readonly ok: false; readonly reason: string };

type ParsedBunLock = { readonly packages?: Record<string, unknown> };

function isParsedBunLock(value: unknown): value is ParsedBunLock {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const packages = (value as Record<string, unknown>)["packages"];
  return (
    packages === undefined ||
    (packages !== null && typeof packages === "object" && !Array.isArray(packages))
  );
}

// bun.lock allows trailing commas (JSONC-lite) but no comments in practice —
// stripping them is enough to make it JSON.parse-able.
function stripTrailingCommas(jsonc: string): string {
  return jsonc.replace(/,(\s*[}\]])/g, "$1");
}

function parseNameAndVersion(
  resolvedNameAtVersion: string,
): { readonly name: string; readonly version: string } | null {
  const match = resolvedNameAtVersion.match(/^(@[^/]+\/[^@]+|[^@]+)@(.+)$/);
  const [, name, version] = match ?? [];
  return name !== undefined && version !== undefined ? { name, version } : null;
}

// packages are visited in file order, so each lookup resumes where the last one ended
// (a per-entry slice+split of the whole file would be quadratic on real lockfiles).
function createLineLocator(raw: string): (lockKey: string) => number {
  let offset = Math.max(raw.indexOf('"packages"'), 0);
  let line = 1;
  for (let i = 0; i < offset; i++) if (raw.charCodeAt(i) === 10) line++;
  return (lockKey) => {
    const at = raw.indexOf(`${JSON.stringify(lockKey)}:`, offset);
    if (at < 0) return 1;
    for (let i = offset; i < at; i++) if (raw.charCodeAt(i) === 10) line++;
    offset = at;
    return line;
  };
}

/**
 * Every entry of `root`'s bun.lock `packages` graph as `{ lockKey, name, version }`.
 * Name and version come from the entry's own resolved `name@version` value, not
 * the key (keys are hoisting-conflict paths).
 *
 * `undefined` when there is no bun.lock. A lockfile that cannot be parsed, or
 * holds an entry not readable as `name@version`, fails closed (`ok: false`)
 * instead of silently shrinking the package list. A lockfile without a
 * `packages` key yields an empty list.
 */
export function readLockfilePackages(root: string): LockfileRead | undefined {
  let raw: string;
  try {
    raw = readFileSync(join(root, "bun.lock"), "utf-8");
  } catch {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripTrailingCommas(raw));
  } catch {
    return { ok: false, reason: "not valid JSON" };
  }
  if (!isParsedBunLock(parsed)) return { ok: false, reason: "unexpected top-level shape" };

  const lineOf = createLineLocator(raw);
  const packages: LockPackage[] = [];
  for (const [lockKey, entry] of Object.entries(parsed.packages ?? {})) {
    if (!Array.isArray(entry) || typeof entry[0] !== "string") {
      return { ok: false, reason: `entry "${lockKey}" is not a resolved-package tuple` };
    }
    const nameAndVersion = parseNameAndVersion(entry[0]);
    if (!nameAndVersion) {
      return { ok: false, reason: `entry "${lockKey}" is not readable as name@version` };
    }
    packages.push({ lockKey, ...nameAndVersion, line: lineOf(lockKey) });
  }
  return { ok: true, packages };
}
