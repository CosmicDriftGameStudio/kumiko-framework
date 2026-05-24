import type { EntityId, TenantId } from "../engine/types/identifiers";

export type CursorQueryOptions = {
  tenantId: TenantId;
  cursor?: string;
  limit?: number;
  filterIds?: readonly EntityId[];
  sort?: string;
  sortDirection?: "asc" | "desc";
};

export type CursorResult<T> = {
  rows: T[];
  nextCursor: string | null;
  /** Optional total row count — nur present wenn der Caller `totalCount: true`
   *  in der Query setzt. */
  total?: number;
};

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
