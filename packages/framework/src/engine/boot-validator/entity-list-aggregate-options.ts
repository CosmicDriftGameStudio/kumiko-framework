import type { EntityDefinition } from "@cosmicdrift/kumiko-types/fields";
import { isListFilterAllowed } from "../../db/entity-field-encryption.ts";
import { isFieldFilterable } from "../screen-filter-ops.ts";

import type { EntityListScreenDefinition } from "../types/screen.ts";
import {
  entityAggregateFieldLookup,
  validateListTableAggregateFieldTypes,
} from "./list-table-aggregate-options.ts";

const RANGE_FACET_TYPES: readonly string[] = ["number", "decimal", "money", "bigInt"];

function validateRangeFacets(
  where: string,
  facets: EntityListScreenDefinition["facets"],
  entity: EntityDefinition,
): void {
  for (const [field, config] of Object.entries(facets ?? {})) {
    if (config === false || config.display !== "range") continue;
    const def = Object.hasOwn(entity.fields, field) ? entity.fields[field] : undefined;
    if (def === undefined || !RANGE_FACET_TYPES.includes(def.type)) {
      throw new Error(
        `${where} facets.${field}: display "range" needs a number, decimal, money or bigInt field.`,
      );
    }
    if (!isFieldFilterable(def) || !isListFilterAllowed(entity, field, { op: "gte", value: 0 })) {
      throw new Error(
        `${where} facets.${field}: display "range" needs filterable: true on a field that is not encrypted, personal or secret.`,
      );
    }
  }
}

export function validateEntityListAggregateOptions(
  where: string,
  screen: EntityListScreenDefinition,
  entity: EntityDefinition,
): void {
  if (screen.table !== undefined) {
    validateListTableAggregateFieldTypes(
      where,
      screen.table,
      entityAggregateFieldLookup(entity),
      true,
    );
  }
  validateRangeFacets(where, screen.facets, entity);
}
