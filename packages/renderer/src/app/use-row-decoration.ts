import type { ListRowDecoration } from "@cosmicdrift/kumiko-framework/ui-types";
import { isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";
import { useEffect, useMemo, useRef } from "react";
import { useQuery } from "../hooks/use-query.ts";

type Row = Readonly<Record<string, unknown>>;

function rowId(row: Row): string | undefined {
  const id = row["id"];
  return typeof id === "string" ? id : undefined;
}

function decorationFieldsById(answer: unknown): ReadonlyMap<string, Row> {
  const byId = new Map<string, Row>();
  const entries = isPlainObject(answer) ? answer["rows"] : undefined;
  if (!Array.isArray(entries)) return byId;
  for (const entry of entries) {
    if (!isPlainObject(entry)) continue;
    const id = rowId(entry);
    if (id !== undefined) byId.set(id, entry);
  }
  return byId;
}

/** Decoration fields win over same-named row fields; the row id is kept. Entries for ids not in `rows` and malformed entries are ignored. */
export function mergeRowDecoration(rows: readonly Row[], answer: unknown): readonly Row[] {
  const byId = decorationFieldsById(answer);
  if (byId.size === 0) return rows;
  return rows.map((row) => {
    const id = rowId(row);
    const fields = id === undefined ? undefined : byId.get(id);
    return fields === undefined ? row : { ...row, ...fields, id: row["id"] };
  });
}

/**
 * One decoration call per list answer. `answerToken` changes with every new list answer;
 * the decoration query is not live itself. A changed id set refetches through the payload,
 * so only a new answer with the same ids calls `refetch`. Loading and error show the plain rows.
 */
export function useRowDecoration(
  decoration: ListRowDecoration | undefined,
  rows: readonly Row[],
  answerToken: unknown,
): readonly Row[] {
  const ids = rows.flatMap((row) => {
    const id = rowId(row);
    return id === undefined ? [] : [id];
  });
  const idsKey = ids.join("\n");
  const enabled = decoration !== undefined && ids.length > 0;
  const { data, error, refetch } = useQuery<unknown>(
    decoration?.query ?? "",
    { ...decoration?.params, ids },
    { enabled },
  );

  const lastAnswerRef = useRef<{ readonly token: unknown; readonly idsKey: string } | null>(null);
  useEffect(() => {
    const last = lastAnswerRef.current;
    lastAnswerRef.current = enabled ? { token: answerToken, idsKey } : null;
    if (enabled && last !== null && last.token !== answerToken && last.idsKey === idsKey) {
      void refetch();
    }
  }, [enabled, answerToken, idsKey, refetch]);

  return useMemo(
    () => (!enabled || error !== null || data === null ? rows : mergeRowDecoration(rows, data)),
    [enabled, error, data, rows],
  );
}
