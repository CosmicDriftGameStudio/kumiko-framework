// Wire-format helpers for `documentExtract.pages` — the column is encrypted
// longText (jsonb has no encryption support), so writers must persist
// JSON.stringify(IngestPage[]) and readers must parse back. Centralising
// the codec here keeps liteparse + recipe consumers lockstep with the
// entity shape (kumiko-framework#1549/1).

import { isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";
import type { IngestPage } from "./entity.js";

export function writeIngestPages(pages: readonly IngestPage[]): string {
  return JSON.stringify(pages);
}

export function readIngestPages(raw: unknown): IngestPage[] {
  if (raw == null) return [];
  // Executor decrypt returns the plaintext string; raw SQL / stale jsonb
  // rows may still surface as an already-parsed array — accept both.
  const parsed: unknown = typeof raw === "string" ? parseJson(raw) : raw;
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(isIngestPage);
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function isIngestPage(value: unknown): value is IngestPage {
  return (
    isPlainObject(value) &&
    typeof value["pageNumber"] === "number" &&
    typeof value["text"] === "string"
  );
}
