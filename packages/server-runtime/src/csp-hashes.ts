import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isPlainObject, parseJsonOrThrow } from "@cosmicdrift/kumiko-framework/utils";
import { BUNDLED_ASSETS_DIST_DIR } from "./bundled-assets.js";
import { isScriptHash, type SecurityHeadersOption } from "./security-headers.js";

export const CSP_HASHES_FILE = "csp-hashes.json";

export type CspHashesFile = { readonly scriptSrc: readonly string[] };

const INLINE_SCRIPT_PATTERN = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
const SRC_ATTRIBUTE_PATTERN = /\ssrc\s*=/i;
const TYPE_ATTRIBUTE_PATTERN = /\stype\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;
// Data blocks (application/json, ld+json, templates) never execute, so
// script-src does not apply to them. Importmaps do, and are governed by it.
const EXECUTABLE_SCRIPT_TYPES = new Set([
  "",
  "module",
  "importmap",
  "text/javascript",
  "application/javascript",
]);

function scriptTypeOf(attributes: string): string {
  const match = TYPE_ATTRIBUTE_PATTERN.exec(attributes);
  return (match?.[1] ?? match?.[2] ?? match?.[3] ?? "").trim().toLowerCase();
}

export function inlineScriptHashes(html: string): string[] {
  const hashes: string[] = [];
  for (const match of html.matchAll(INLINE_SCRIPT_PATTERN)) {
    const attributes = ` ${match[1] ?? ""}`;
    const content = match[2] ?? "";
    if (content.length === 0 || SRC_ATTRIBUTE_PATTERN.test(attributes)) continue;
    if (!EXECUTABLE_SCRIPT_TYPES.has(scriptTypeOf(attributes))) continue;
    hashes.push(`sha256-${createHash("sha256").update(content, "utf8").digest("base64")}`);
  }
  return hashes;
}

function htmlFilesUnder(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      // Bundled assets are never served over HTTP.
      if (entry.name === BUNDLED_ASSETS_DIST_DIR) continue;
      files.push(...htmlFilesUnder(join(dir, entry.name)));
    } else if (entry.name.endsWith(".html")) {
      files.push(join(dir, entry.name));
    }
  }
  return files;
}

/** Hashes every inline script in the HTML files of a finished build output, so the
 *  CSP only ever allows code that shipped in the artefact. */
export function collectBuildScriptHashes(distDir: string): CspHashesFile {
  const hashes = new Set<string>();
  for (const file of htmlFilesUnder(distDir)) {
    for (const hash of inlineScriptHashes(readFileSync(file, "utf8"))) hashes.add(hash);
  }
  return { scriptSrc: [...hashes].sort() };
}

export type CspHashesReadResult =
  | { readonly kind: "found"; readonly scriptSrc: readonly string[] }
  | { readonly kind: "missing" }
  | { readonly kind: "invalid"; readonly problem: string };

export function readCspHashes(staticDir: string): CspHashesReadResult {
  const path = join(staticDir, CSP_HASHES_FILE);
  if (!existsSync(path)) return { kind: "missing" };
  try {
    const parsed = parseJsonOrThrow<unknown>(readFileSync(path, "utf8"), CSP_HASHES_FILE);
    const scriptSrc = isPlainObject(parsed) ? parsed["scriptSrc"] : undefined;
    if (!Array.isArray(scriptSrc) || !scriptSrc.every(isScriptHash)) {
      return { kind: "invalid", problem: '"scriptSrc" must be an array of sha256 hashes' };
    }
    return { kind: "found", scriptSrc };
  } catch (error) {
    return { kind: "invalid", problem: error instanceof Error ? error.message : String(error) };
  }
}

/** Hashes for the default CSP. Only an app that keeps the default CSP and serves a
 *  staticDir needs them; a missing or broken file leaves inline scripts blocked, so boot says so. */
export function resolveCspScriptHashes(
  staticDir: string | undefined,
  securityHeaders: SecurityHeadersOption | undefined,
): readonly string[] {
  if (staticDir === undefined || securityHeaders === false) return [];
  const csp = securityHeaders?.csp;
  if (csp === false || typeof csp === "string") return [];
  const result = readCspHashes(staticDir);
  if (result.kind === "found") return result.scriptSrc;
  const problem =
    result.kind === "missing"
      ? `${CSP_HASHES_FILE} not found in ${staticDir} (written by kumiko build)`
      : `${CSP_HASHES_FILE} is invalid: ${result.problem}`;
  // biome-ignore lint/suspicious/noConsole: boot-time warn, no logger configured this early
  console.warn(
    `[runProdApp] ${problem}; the default CSP carries no inline-script hashes, so inline scripts in the served HTML are blocked. ` +
      "Rebuild with kumiko build, or set securityHeaders.csp.",
  );
  return [];
}
