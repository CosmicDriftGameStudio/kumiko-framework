// Shared helper fuer ZIP-Path-Berechnung von fileRefs (S2.U3 Atom 3c).
//
// Das Bundle hat zwei Sichten auf die selben fileRefs:
//   1. bundle.json: Eine flat-Liste mit `zipPath` pro fileRef. Reader-
//      Tools koennen so JSON ↔ files/-Pfade verlinken.
//   2. ZIP-Entries: Bytes liegen unter genau diesen `zipPath`-Schluesseln.
//
// Damit beide Sichten NICHT auseinander driften, lebt die Pfad-Berechnung
// EXAKT EINMAL hier. run-user-export befuellt zipPath im fileRef-Item,
// run-export-jobs's bundleToZipEntries nutzt dieselben Pfade als Entry-
// Keys.

import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";

/**
 * Maximale Laenge des sanitized fileName (ohne Extension). Realistic
 * Filenames sind <50, 100 ist eine sichere Grenze fuer ZIP-Kompatibilitaet
 * (PKWARE-spec keine harte limit, aber viele Reader haengen bei extrem
 * langen Namen).
 */
const MAX_SANITIZED_BASENAME_LENGTH = 100;

/**
 * Erlaubte Filename-Chars: alphanumerisch, dot, dash, underscore. Alles
 * andere wird zu underscore replaced. Path-Separator (`/`, `\`),
 * relative-traversal (`..`), und null-bytes sind insbesondere ausgeschlossen.
 */
const FILENAME_SAFE_CHARS = /[^a-zA-Z0-9._-]/g;

/**
 * Sanitize einen vom User-Input stammenden fileName fuer Verwendung als
 * ZIP-internal-path-Suffix. Defense gegen:
 *   - Path-Traversal:  "../../etc/passwd" → "file.etc_passwd"
 *   - Null-Bytes:      "report\x00.pdf"   → "report_.pdf"
 *   - Path-Separator:  "sub/dir/file.txt" → "sub_dir_file.txt"
 *   - Reserved-Names:  "." / ".." / "..."  → "file"
 *   - Empty input:     "" / null / undef   → "unnamed"
 *   - Ueberlange:      lange Strings auf MAX_SANITIZED_BASENAME_LENGTH gekappt
 *                      (Extension bleibt erhalten falls vorhanden)
 *   - Unicode:         non-ASCII → underscore. Leading-strip kann auch dazu
 *                      fuehren dass alle-Unicode-Names zu "file" werden.
 *
 * Output ist garantiert: nicht leer, kein Path-Separator, max-len enforced,
 * keine `..`-Sequenz im finalen String.
 */
export function sanitizeZipFilename(raw: string): string {
  if (raw === undefined || raw === null || raw === "") return "unnamed";

  // Extension extrahieren (letzte ".X" wo X kein "." enthaelt).
  const lastDot = raw.lastIndexOf(".");
  const hasExt = lastDot > 0 && lastDot < raw.length - 1;
  const baseName = hasExt ? raw.slice(0, lastDot) : raw;
  const extension = hasExt ? raw.slice(lastDot + 1) : "";

  const safeBase = collapseUnsafe(baseName).slice(0, MAX_SANITIZED_BASENAME_LENGTH);
  const safeExt = collapseUnsafe(extension).slice(0, 20);

  // Empty oder all-underscores → "file" als reproduzierbarer Fallback.
  const finalBase = safeBase.length === 0 ? "file" : safeBase;

  return safeExt.length > 0 ? `${finalBase}.${safeExt}` : finalBase;
}

/**
 * 3-step Sanitize:
 *   1. Replace alles ausser [a-zA-Z0-9._-] mit "_"
 *   2. Collapse `..` (oder mehr) → "_" — verhindert dass `..` nach
 *      Sanitize uebrig bleibt (z.B. wenn input nur dots+slashes ist).
 *   3. Strip leading [._-]+ — verhindert hidden-file-Patterns + leere
 *      Basenames + leading-segments die nach den ersten zwei Steps
 *      lauter underscores haetten.
 */
function collapseUnsafe(s: string): string {
  let out = s.replace(FILENAME_SAFE_CHARS, "_");
  out = out.replace(/\.{2,}/g, "_");
  out = out.replace(/^[._-]+/, "");
  return out;
}

/**
 * Berechnet den ZIP-internal-Pfad fuer einen fileRef. Layout:
 *   files/<tenantId>/<fileRefId>-<sanitized-fileName>
 *
 * tenantId + fileRefId sind UUID-shape (sicher); fileName geht durch
 * sanitizeZipFilename. Garantiert kein path-traversal.
 */
export function buildFileRefZipPath(args: {
  readonly tenantId: TenantId;
  readonly fileRefId: string;
  readonly fileName: string;
}): string {
  const safeName = sanitizeZipFilename(args.fileName);
  return `files/${args.tenantId}/${args.fileRefId}-${safeName}`;
}
