import { createHash } from "node:crypto";
import { isPlainObject, parseJsonOrThrow } from "@cosmicdrift/kumiko-framework/utils";
import { isScriptHash } from "./security-headers.ts";

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

export type CspHashesReadResult =
  | { readonly kind: "found"; readonly scriptSrc: readonly string[] }
  | { readonly kind: "missing" }
  | { readonly kind: "invalid"; readonly problem: string };

export function parseCspHashes(text: string): CspHashesReadResult {
  try {
    const parsed = parseJsonOrThrow<unknown>(text, CSP_HASHES_FILE);
    const scriptSrc = isPlainObject(parsed) ? parsed["scriptSrc"] : undefined;
    if (!Array.isArray(scriptSrc) || !scriptSrc.every(isScriptHash)) {
      return { kind: "invalid", problem: '"scriptSrc" must be an array of sha256 hashes' };
    }
    return { kind: "found", scriptSrc };
  } catch (error) {
    return { kind: "invalid", problem: error instanceof Error ? error.message : String(error) };
  }
}
