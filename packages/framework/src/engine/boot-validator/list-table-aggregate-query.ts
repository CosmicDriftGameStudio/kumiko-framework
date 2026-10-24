import type { QueryHandlerDef } from "@cosmicdrift/kumiko-types/handlers";
import { resolveEntityBehindListQuery } from "../entity-list-searchability.ts";
import { normalizeListColumn } from "../screen-helpers.ts";
import type { FeatureDefinition } from "../types/index.ts";

import type { ListColumnSpec, ListTableOptions } from "../types/screen.ts";
import {
  type AggregateFieldInfo,
  entityAggregateFieldLookup,
  validateListTableAggregateFieldTypes,
} from "./list-table-aggregate-options.ts";
import { findEntity } from "./parent-ref.ts";
import { getZodObjectShape } from "./zod-shape.ts";

function columnValueTypeLookup(
  columns: readonly ListColumnSpec[],
): (field: string) => AggregateFieldInfo | undefined {
  const valueTypes = new Map(
    columns
      .map(normalizeListColumn)
      .flatMap((col) => (col.valueType === undefined ? [] : [[col.field, col.valueType] as const])),
  );
  return (field) => {
    const type = valueTypes.get(field);
    return type === undefined ? undefined : { type, multiple: false, secret: false };
  };
}

// Same pattern as searchable vs search: grouping and totals send `aggregate`,
// which a query without it in its Zod schema would reject on every load.
export function validateListTableAggregateQuery(args: {
  readonly prefix: string;
  readonly query: string;
  readonly table?: ListTableOptions | undefined;
  readonly columns: readonly ListColumnSpec[];
  readonly handler: QueryHandlerDef | undefined;
  readonly featureMap: ReadonlyMap<string, FeatureDefinition>;
}): void {
  const { prefix, query, table, handler } = args;
  // skip: neither grouping nor totals declared, nothing travels via aggregate
  if (table?.grouping === undefined && table?.totals === undefined) return;
  const shape = getZodObjectShape(handler?.schema);
  if (shape === undefined || !("aggregate" in shape)) {
    throw new Error(
      `${prefix}: table.grouping/table.totals need query "${query}" to accept "aggregate" — ` +
        `reuse entityListSchema (or listAggregatePayloadSchema) in the handler's schema and answer it ` +
        `with answerListAggregate, or remove grouping and totals.`,
    );
  }
  const entity = resolveEntityBehindListQuery(query, handler, (name) =>
    findEntity(args.featureMap, name),
  );
  const lookup =
    entity === undefined ? columnValueTypeLookup(args.columns) : entityAggregateFieldLookup(entity);
  validateListTableAggregateFieldTypes(prefix, table, lookup, entity !== undefined);
}
