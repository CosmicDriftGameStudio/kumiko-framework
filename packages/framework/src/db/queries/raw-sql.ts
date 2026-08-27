import type { AnyDb } from "../query";
import { asRawClient, unsafeReadRetrying } from "../query";

/** Escape hatch for caller-built SQL that may write (or lock). No closed-connection retry —
 *  retrying an ambiguous write risks double-apply (#1358). Prefer {@link executeRawQueryRead}
 *  for SELECT-only paths. */
export async function executeRawQuery<T = Record<string, unknown>>(
  db: AnyDb,
  sqlText: string,
  params: readonly unknown[] = [],
): Promise<readonly T[]> {
  return (await asRawClient(db).unsafe(sqlText, params)) as readonly T[];
}

/** SELECT-only escape hatch with the #1163 closed-connection retry. Do not pass
 *  INSERT/UPDATE/DELETE — retry re-executes the statement. */
export async function executeRawQueryRead<T = Record<string, unknown>>(
  db: AnyDb,
  sqlText: string,
  params: readonly unknown[] = [],
): Promise<readonly T[]> {
  return unsafeReadRetrying<T>(db, sqlText, params);
}

export async function pingDatabase(db: AnyDb): Promise<void> {
  await asRawClient(db).unsafe("SELECT 1");
}
