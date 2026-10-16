/**
 * Exception files for the dependency checks (licenses, security). Merged: the
 * defaults bundled next to this package's sources and an optional file of the
 * same name in each given root (the scanned repo's root, plus any ancestor
 * whose installation the scan read packages or a lockfile from).
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DAY_MS = 24 * 60 * 60 * 1000;
const BUNDLED_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

export type ExceptionValidity = { readonly valid: boolean; readonly expired: boolean };

/** Start of the day after `expires` (a `YYYY-MM-DD` date, UTC) in epoch ms; undefined when it is not a plain date. */
export function expiryEndMs(expires: string): number | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expires)) return undefined;
  try {
    return Temporal.PlainDate.from(expires).add({ days: 1 }).toZonedDateTime("UTC")
      .epochMilliseconds;
  } catch {
    return undefined;
  }
}

// An exception without an expiry never expires; callers that must not allow that (security) reject it on load.
export function isExceptionValid(
  expires: string | undefined,
  nowMs: number = Date.now(),
): ExceptionValidity {
  if (!expires) return { valid: true, expired: false };
  const endMs = expiryEndMs(expires);
  if (endMs === undefined) return { valid: false, expired: false };
  // The exception holds through the END of its expiry day.
  const expired = nowMs >= endMs;
  return { valid: !expired, expired };
}

export function findExpiringSoon<T extends { readonly expires?: string }>(
  items: readonly T[],
  withinDays = 30,
  nowMs: number = Date.now(),
): T[] {
  const horizonMs = nowMs + withinDays * DAY_MS;
  return items.filter((item) => {
    const endMs = item.expires ? expiryEndMs(item.expires) : undefined;
    return endMs !== undefined && nowMs < endMs && endMs - DAY_MS <= horizonMs;
  });
}

/** Wildcard match for package names (trailing `*` only). */
export function matchesPackageName(pattern: string, name: string): boolean {
  if (pattern === name) return true;
  if (!pattern.endsWith("*")) return false;
  const prefix = pattern.slice(0, -1);
  return prefix.length > 0 && name.startsWith(prefix);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

class MissingFieldError extends Error {
  constructor(readonly field: string) {
    super(`missing or blank "${field}"`);
  }
}

export type ExceptionSource = { readonly file: string; readonly origin: "bundled" | "repo" };

export function exceptionSources(
  filename: string,
  roots: readonly string[],
  bundledDir = BUNDLED_DIR,
): ExceptionSource[] {
  const sources: ExceptionSource[] = [
    { file: join(bundledDir, filename), origin: "bundled" },
    ...[...new Set(roots)].map((root) => ({ file: join(root, filename), origin: "repo" as const })),
  ];
  return sources.filter((source) => existsSync(source.file));
}

function readExceptionEntries(source: ExceptionSource, filename: string): unknown[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(source.file, "utf-8"));
  } catch {
    console.warn(
      `  WARN: ${source.origin} ${filename} (${source.file}) is not readable JSON — ignored.`,
    );
    return [];
  }
  const entries = isRecord(parsed) ? parsed["exceptions"] : undefined;
  if (!Array.isArray(entries)) {
    console.warn(`  WARN: ${source.origin} ${filename} has no "exceptions" array — ignored.`);
    return [];
  }
  return entries;
}

/**
 * Loads and merges the exception entries of `filename`. `parse` builds one
 * exception from its entry; asking `field(key)` for a missing or blank string
 * drops that entry with a warning. A broken file or entry is never trusted: a
 * dropped exception can only make a check stricter.
 */
export function loadExceptionEntries<T>(options: {
  readonly filename: string;
  readonly roots: readonly string[];
  readonly parse: (field: (key: string) => string) => T;
  readonly bundledDir?: string;
}): T[] {
  const merged: T[] = [];
  for (const source of exceptionSources(options.filename, options.roots, options.bundledDir)) {
    for (const entry of readExceptionEntries(source, options.filename)) {
      try {
        if (!isRecord(entry)) throw new MissingFieldError("(entry is not an object)");
        merged.push(
          options.parse((key) => {
            const value = entry[key];
            if (typeof value !== "string" || value.trim() === "") throw new MissingFieldError(key);
            return value;
          }),
        );
      } catch (err) {
        if (!(err instanceof MissingFieldError)) throw err;
        console.warn(
          `  WARN: ${source.origin} ${options.filename}: entry dropped, ${err.message}.`,
        );
      }
    }
  }
  return merged;
}
