// Shared helper for computing ZIP paths from fileRefs.
//
// The bundle has two views of the same fileRefs:
//   1. bundle.json: A flat list with `zipPath` for each fileRef. Reader
//      tools can use this to link JSON to files/-paths.
//   2. ZIP entries: Bytes are stored under exactly these `zipPath` keys.
//
// To keep both views synchronized, path computation lives EXACTLY ONCE here.
// run-user-export fills zipPath in the fileRef item, and
// run-export-jobs's bundleToZipEntries uses the same paths as entry keys.

import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";

/**
 * Maximum length of the sanitized fileName without its extension. Realistic
 * filenames are <50; 100 is a safe limit for ZIP compatibility
 * (the PKWARE spec has no hard limit, but many readers struggle with
 * extremely long names).
 */
const MAX_SANITIZED_BASENAME_LENGTH = 100;

/**
 * Allowed filename chars: alphanumerics, dot, dash, underscore. Everything
 * else is replaced with an underscore. This excludes path separators (`/`,
 * `\`) and null bytes in particular; relative traversal (`..`) is handled
 * by the basename and leading-dot rules below.
 */
const FILENAME_SAFE_CHARS = /[^a-zA-Z0-9._-]/g;

/**
 * Sanitizes a user-provided fileName for use as a ZIP-internal-path suffix.
 *   - Path traversal:  "../../etc/passwd" → "file.etc_passwd"
 *   - Null bytes:      "report\x00.pdf"   → "report_.pdf"
 *   - Path separators: "sub/dir/file.txt" → "sub_dir_file.txt"
 *   - Reserved names:  "." / ".." / "..."  → "file"
 *   - Empty input:     "" / null / undef   → "unnamed"
 *   - Excessive length: long strings are truncated to
 *                       MAX_SANITIZED_BASENAME_LENGTH
 *                       (the extension is preserved when present)
 *   - Unicode:         non-ASCII characters → underscores. Leading stripping
 *                       can also cause all-Unicode names to become "file".
 *
 * The output is guaranteed to be non-empty, contain no path separators, obey
 * the maximum length, and contain no `..` sequence.
 */
export function sanitizeZipFilename(raw: string): string {
  if (raw === undefined || raw === null || raw === "") return "unnamed";

  // Extract the extension (the last ".X" where X contains no ".").
  const lastDot = raw.lastIndexOf(".");
  const hasExt = lastDot > 0 && lastDot < raw.length - 1;
  const baseName = hasExt ? raw.slice(0, lastDot) : raw;
  const extension = hasExt ? raw.slice(lastDot + 1) : "";

  const safeBase = collapseUnsafe(baseName).slice(0, MAX_SANITIZED_BASENAME_LENGTH);
  const safeExt = collapseUnsafe(extension).slice(0, 20);

  // Empty or all-underscore input → "file" as a reproducible fallback.
  const finalBase = safeBase.length === 0 ? "file" : safeBase;

  return safeExt.length > 0 ? `${finalBase}.${safeExt}` : finalBase;
}

/**
 * Three-step sanitization:
 *   1. Replace everything except [a-zA-Z0-9._-] with "_".
 *   2. Collapse `..` (or more) to "_"—this prevents `..` from surviving
 *      sanitization (for example, when the input contains only dots and
 *      slashes).
 *   3. Strip leading [._-]+—this prevents hidden-file patterns, empty
 *      basenames, and leading segments that would consist entirely of
 *      underscores after the first two steps.
 */
function collapseUnsafe(s: string): string {
  let out = s.replace(FILENAME_SAFE_CHARS, "_");
  out = out.replace(/\.{2,}/g, "_");
  out = out.replace(/^[._-]+/, "");
  return out;
}

/**
 * Computes the ZIP-internal path for a fileRef. Layout:
 *   files/<tenantId>/<fileRefId>-<sanitized-fileName>
 *
 * tenantId and fileRefId have UUID shapes and are safe; fileName is passed
 * through sanitizeZipFilename. Path traversal is guaranteed to be excluded.
 */
export function buildFileRefZipPath(args: {
  readonly tenantId: TenantId;
  readonly fileRefId: string;
  readonly fileName: string;
}): string {
  const safeName = sanitizeZipFilename(args.fileName);
  return `files/${args.tenantId}/${args.fileRefId}-${safeName}`;
}
