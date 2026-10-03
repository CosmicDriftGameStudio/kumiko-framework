import { normalizeMimeType, sniffMimeType } from "./types.js";

const OCTET_STREAM = "application/octet-stream";
const GENERIC_MIME_TYPES: ReadonlySet<string> = new Set(["", OCTET_STREAM, "binary/octet-stream"]);

// Signatures that identify exactly one type. sniffMimeType also matches OLE and
// ZIP, which it maps to msword/docx — wrong for .xls/.xlsx/.zip, so they are
// handled separately below.
const UNAMBIGUOUS_SNIFFED_TYPES: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
]);

const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];
const XML_PROBE_BYTES = 512;

const EXTENSION_FALLBACK: Readonly<Record<string, string>> = {
  xml: "application/xml",
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  zip: "application/zip",
  json: "application/json",
  csv: "text/csv",
  txt: "text/plain",
};

function hasPrefix(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return prefix.every((byte, i) => bytes[i] === byte);
}

// Textual start only: a NUL in the probe means binary (or UTF-16, which is
// deliberately not detected). HTML also starts with `<` and must not be
// relabelled as XML.
function looksLikeXml(bytes: Uint8Array): boolean {
  const probe = bytes.subarray(0, XML_PROBE_BYTES);
  if (probe.includes(0)) return false;
  const text = new TextDecoder().decode(probe).replace(/^﻿/, "").trimStart();
  if (text.startsWith("<?xml")) return true;
  if (!/^<[A-Za-z_]/.test(text)) return false;
  return !/^<(html|head|body|script)\b/i.test(text);
}

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot === -1 ? "" : filename.slice(dot + 1).toLowerCase();
}

/**
 * Content type for a file whose sender may not have declared a useful one
 * (mail attachments commonly arrive as application/octet-stream). A concrete
 * declared type is returned untouched; a generic/missing one is resolved from
 * the bytes first and the file extension only as fallback.
 */
export function resolveContentType(args: {
  readonly declared: string | undefined;
  readonly bytes: Uint8Array;
  readonly filename: string | undefined;
}): string {
  const declared = args.declared ?? "";
  if (!GENERIC_MIME_TYPES.has(normalizeMimeType(declared))) return declared;

  const sniffed = sniffMimeType(args.bytes);
  if (sniffed !== null && UNAMBIGUOUS_SNIFFED_TYPES.has(sniffed)) return sniffed;
  if (looksLikeXml(args.bytes)) return "application/xml";

  const fromExtension = EXTENSION_FALLBACK[extensionOf(args.filename ?? "")];
  if (fromExtension !== undefined) return fromExtension;
  if (hasPrefix(args.bytes, ZIP_SIGNATURE)) return "application/zip";
  return OCTET_STREAM;
}
