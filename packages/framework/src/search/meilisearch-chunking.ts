import type { EntityId } from "../engine/types/identifiers.ts";
import { meilisearchDocId } from "./meilisearch-adapter-internals.ts";
import type { SearchDocument } from "./types.ts";

// Meilisearch indexes at most 65_535 word positions per attribute, and a hard
// separator advances the position by up to 8. 8_000 characters yield at most
// 8_000 words (single-character words separated by one space), so a piece of this
// size stays far below the limit even in the worst case. Longer values are split
// into pieces instead of being cut: nothing is silently dropped from the index.
export const CHUNK_MAX_CHARS = 8_000;
export const CHUNK_OVERLAP_CHARS = 200;

const WHITESPACE = /\s/;

function lastWhitespaceBefore(value: string, end: number, floor: number): number {
  for (let i = end - 1; i > floor; i--) {
    if (WHITESPACE.test(value.charAt(i))) return i;
  }
  return -1;
}

// Start of the next piece: about CHUNK_OVERLAP_CHARS before the cut, moved forward to a word
// start, so a word or short phrase straddling the cut is whole in at least one piece.
function nextPieceStart(value: string, pieceStart: number, cut: number): number {
  const rawStart = Math.max(cut - CHUNK_OVERLAP_CHARS, pieceStart + 1);
  for (let i = rawStart; i < cut; i++) {
    if (WHITESPACE.test(value.charAt(i - 1))) return i;
  }
  return cut;
}

/** Splits a long value into pieces of at most CHUNK_MAX_CHARS, cut at whitespace. */
export function splitLongText(value: string): string[] {
  if (value.length <= CHUNK_MAX_CHARS) return [value];
  const pieces: string[] = [];
  let start = 0;
  while (value.length - start > CHUNK_MAX_CHARS) {
    const limit = start + CHUNK_MAX_CHARS;
    const space = lastWhitespaceBefore(value, limit, start + CHUNK_OVERLAP_CHARS);
    const cut = space === -1 ? limit : space;
    pieces.push(value.slice(start, cut));
    start = nextPieceStart(value, start, cut);
  }
  pieces.push(value.slice(start));
  return pieces;
}

export type MeilisearchPieceDocument = Record<string, unknown> & { readonly _id: string };

export function pieceDocId(baseId: string, chunk: number): string {
  return chunk === 0 ? baseId : `${baseId}_c${chunk}`;
}

/**
 * One Meilisearch document per piece. Piece 0 keeps the id the entity always had (existing
 * documents stay valid, no duplicates) and carries all short fields; piece n holds the n-th
 * parts of the long fields.
 */
export function buildPieceDocuments(doc: SearchDocument): MeilisearchPieceDocument[] {
  const shortFields: Record<string, unknown> = {};
  const longPieces: Array<[string, string[]]> = [];
  for (const [key, value] of Object.entries(doc.fields)) {
    if (typeof value === "string" && value.length > CHUNK_MAX_CHARS) {
      longPieces.push([key, splitLongText(value)]);
    } else {
      shortFields[key] = value;
    }
  }
  const baseId = meilisearchDocId(doc.entityType, doc.entityId);
  const pieceCount = Math.max(1, ...longPieces.map(([, pieces]) => pieces.length));
  const documents: MeilisearchPieceDocument[] = [];
  for (let chunk = 0; chunk < pieceCount; chunk++) {
    const piece: Record<string, unknown> = chunk === 0 ? { ...shortFields } : {};
    for (const [key, pieces] of longPieces) {
      const part = pieces[chunk];
      if (part !== undefined) piece[key] = part;
    }
    documents.push({
      ...piece,
      _id: pieceDocId(baseId, chunk),
      _type: doc.entityType,
      _weight: doc.weight,
      _entityId: doc.entityId,
      _chunk: chunk,
    });
  }
  return documents;
}

function quoted(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Filter matching every piece (and a legacy unchunked document) of one entity. */
export function entityPiecesFilter(entityType: string, entityId: EntityId): string {
  return `(_type = ${quoted(entityType)} AND _entityId = ${quoted(String(entityId))})`;
}

/** Filter matching the pieces of one entity from `fromChunk` on: the leftovers of a longer earlier version. */
export function stalePiecesFilter(
  entityType: string,
  entityId: EntityId,
  fromChunk: number,
): string {
  return `(_type = ${quoted(entityType)} AND _entityId = ${quoted(String(entityId))} AND _chunk >= ${fromChunk})`;
}

export function filterTypeClause(entityType: string): string {
  return `_type = ${quoted(entityType)}`;
}
