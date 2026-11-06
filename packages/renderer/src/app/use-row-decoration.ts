import type { ListRowDecoration } from "@cosmicdrift/kumiko-framework/ui-types";
import { isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "../hooks/use-query.ts";

type Row = Readonly<Record<string, unknown>>;
type FieldsById = ReadonlyMap<string, Row>;

function rowId(row: Row): string | undefined {
  const id = row["id"];
  return typeof id === "string" ? id : undefined;
}

function decorationFieldsById(answer: unknown): FieldsById {
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

function applyDecorationFields(rows: readonly Row[], byId: FieldsById): readonly Row[] {
  if (byId.size === 0) return rows;
  return rows.map((row) => {
    const id = rowId(row);
    const fields = id === undefined ? undefined : byId.get(id);
    return fields === undefined ? row : { ...row, ...fields, id: row["id"] };
  });
}

/** Decoration fields win over same-named row fields; the row id is kept. Entries for ids not in `rows` and malformed entries are ignored. */
export function mergeRowDecoration(rows: readonly Row[], answer: unknown): readonly Row[] {
  return applyDecorationFields(rows, decorationFieldsById(answer));
}

type Accumulated = {
  readonly resetKey: string;
  readonly answeredIds: ReadonlySet<string>;
  readonly fieldsById: FieldsById;
  // Ids of the first send in this cycle. The first page passes the query's `ids.max` by
  // definition, so every later send, including a refresh of all loaded rows, stays within it.
  readonly batchSize: number | undefined;
};

function emptyAccumulated(resetKey: string): Accumulated {
  return { resetKey, answeredIds: new Set(), fieldsById: new Map(), batchSize: undefined };
}

function absorbAnswer(
  previous: Accumulated,
  answer: unknown,
  sentIds: readonly string[],
): Accumulated {
  // A sent id the answer no longer contains loses its decoration; ids not asked for keep theirs,
  // so rows do not flicker while a refresh runs batch by batch.
  const fieldsById = new Map(previous.fieldsById);
  for (const id of sentIds) fieldsById.delete(id);
  for (const [id, fields] of decorationFieldsById(answer)) fieldsById.set(id, fields);
  return {
    resetKey: previous.resetKey,
    answeredIds: new Set([...previous.answeredIds, ...sentIds]),
    fieldsById,
    batchSize: previous.batchSize ?? sentIds.length,
  };
}

function isAppendOf(previousIds: readonly string[], ids: readonly string[]): boolean {
  return ids.length > previousIds.length && previousIds.every((id, index) => ids[index] === id);
}

/**
 * Sends only ids that have no answer yet, so an infinite list asks once per new page and the
 * answers are kept across calls. `resetKey` drops them (filter or sort changed); a new list
 * answer that is not an append (reload after a write) asks for every id again, in batches of
 * the first send's size.
 * Loading and error show the plain rows.
 */
export function useRowDecoration(
  decoration: ListRowDecoration | undefined,
  rows: readonly Row[],
  answerToken: unknown,
  resetKey: string,
): readonly Row[] {
  const ids = rows.flatMap((row) => {
    const id = rowId(row);
    return id === undefined ? [] : [id];
  });

  const [stored, setStored] = useState(() => emptyAccumulated(resetKey));
  const accumulated = stored.resetKey === resetKey ? stored : emptyAccumulated(resetKey);
  const idsToSend = ids
    .filter((id) => !accumulated.answeredIds.has(id))
    .slice(0, accumulated.batchSize);
  const enabled = decoration !== undefined && idsToSend.length > 0;
  const { data, error } = useQuery<unknown>(
    decoration?.query ?? "",
    { ...decoration?.params, ids: idsToSend },
    { enabled },
  );

  const sentIdsRef = useRef(idsToSend);
  useEffect(() => {
    sentIdsRef.current = idsToSend;
  });

  const absorbedAnswerRef = useRef<unknown>(null);
  useEffect(() => {
    if (data === null || data === absorbedAnswerRef.current) return;
    absorbedAnswerRef.current = data;
    const sentIds = sentIdsRef.current;
    setStored((current) =>
      absorbAnswer(
        current.resetKey === resetKey ? current : emptyAccumulated(resetKey),
        data,
        sentIds,
      ),
    );
  }, [data, resetKey]);

  const previousListRef = useRef<{
    readonly token: unknown;
    readonly ids: readonly string[];
  } | null>(null);
  useEffect(() => {
    const previous = previousListRef.current;
    previousListRef.current = { token: answerToken, ids };
    if (previous === null || previous.token === answerToken) return;
    if (isAppendOf(previous.ids, ids)) return;
    setStored((current) => ({
      ...(current.resetKey === resetKey ? current : emptyAccumulated(resetKey)),
      answeredIds: new Set(),
    }));
  }, [answerToken, ids, resetKey]);

  const fieldsById = accumulated.fieldsById;
  const decorated = decoration !== undefined;
  return useMemo(
    () => (!decorated || error !== null ? rows : applyDecorationFields(rows, fieldsById)),
    [decorated, error, rows, fieldsById],
  );
}
