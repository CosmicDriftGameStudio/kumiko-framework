export type { CursorQueryOptions, CursorResult } from "@cosmicdrift/kumiko-types/cursor-types";

// String-basiert damit UUIDs (Default seit Sprint F) + Integer-Auto-Increment
// durch denselben Cursor-Pfad laufen. UUIDv7 erfüllt die lex-Monotonie
// (time-ordered Prefix); UUIDv4 nicht — wer den nutzt, kriegt inkorrekte
// cursor-Reihenfolge (Default ist v7).
export function encodeCursor(id: string | number): string {
  return Buffer.from(String(id)).toString("base64url");
}

export function decodeCursor(cursor: string): string {
  const decoded = Buffer.from(cursor, "base64url").toString();
  if (decoded === "") throw new Error(`Invalid cursor: ${cursor}`);
  return decoded;
}

type KeysetCursorPayload = { readonly v: string | null; readonly i: string };

export type DecodedKeysetCursor = {
  readonly id: string;
  // undefined = legacy id-only cursor still in flight from a client
  readonly sortValue: string | null | undefined;
};

export function encodeKeysetCursor(sortValue: string | null, id: string): string {
  return encodeCursor(JSON.stringify({ v: sortValue, i: id } satisfies KeysetCursorPayload));
}

export function decodeKeysetCursor(cursor: string): DecodedKeysetCursor {
  const decoded = decodeCursor(cursor);
  return parseKeysetPayload(decoded) ?? { id: decoded, sortValue: undefined };
}

function parseKeysetPayload(decoded: string): DecodedKeysetCursor | null {
  if (!decoded.startsWith("{")) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(decoded);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const { v, i } = raw as Record<string, unknown>;
  if (typeof i !== "string" || i === "") return null;
  if (v !== null && typeof v !== "string") return null;
  return { id: i, sortValue: v };
}
