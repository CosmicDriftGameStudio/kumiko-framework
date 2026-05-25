import type { AnyDb } from "../query";
import { asRawClient } from "../query";

/** Escape hatch for caller-built SQL (ownership clauses, entity list queries). */
export async function executeRawQuery<T = Record<string, unknown>>(
  db: AnyDb,
  sqlText: string,
  params: readonly unknown[] = [],
): Promise<readonly T[]> {
  return (await asRawClient(db).unsafe(sqlText, params)) as readonly T[];
}

export async function pingDatabase(db: AnyDb): Promise<void> {
  await asRawClient(db).unsafe("SELECT 1");
}
