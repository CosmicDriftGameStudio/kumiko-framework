import type { EntityDefinition } from "@cosmicdrift/kumiko-types/fields";
import { isListAggregateGroupable } from "../../db/aggregate-sql.ts";
import { isListFilterAllowed } from "../../db/entity-field-encryption.ts";
import { isFieldFilterable } from "../screen-filter-ops.ts";

import type { EntityListScreenDefinition } from "../types/screen.ts";
import { bootRuleError } from "./boot-rule.ts";
import {
  entityAggregateFieldLookup,
  validateListTableAggregateFieldTypes,
} from "./list-table-aggregate-options.ts";
import { LIST_TABLE_AGGREGATE_RULES } from "./list-table-aggregate-rules.ts";

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
      throw bootRuleError(LIST_TABLE_AGGREGATE_RULES.rangeFacetFieldType, {
        message: `${where} facets.${field}: display "range" needs a number, decimal, money or bigInt field.`,
      });
    }
    if (!isFieldFilterable(def) || !isListFilterAllowed(entity, field, { op: "gte", value: 0 })) {
      throw bootRuleError(LIST_TABLE_AGGREGATE_RULES.rangeFacetNotFilterable, {
        message: `${where} facets.${field}: display "range" needs filterable: true on a field that is not encrypted, personal or secret.`,
      });
    }
  }
}

const COUNTED_FACET_TYPES: readonly string[] = ["select", "boolean", "reference"];

function validateCountedChipFacets(
  where: string,
  facets: EntityListScreenDefinition["facets"],
  entity: EntityDefinition,
): void {
  const lookup = entityAggregateFieldLookup(entity);
  for (const [field, config] of Object.entries(facets ?? {})) {
    if (config === false || config.display !== "chips") continue;
    if (config.showCounts !== true && config.hideEmpty !== true) continue;
    const info = lookup(field);
    if (
      info === undefined ||
      info.secret ||
      !COUNTED_FACET_TYPES.includes(info.type) ||
      !isListAggregateGroupable(info.type, info.multiple)
    ) {
      throw bootRuleError(LIST_TABLE_AGGREGATE_RULES.countFacetNotGroupable, {
        message: `${where} facets.${field}: chips with showCounts or hideEmpty need a select, boolean or single reference field that is not encrypted, personal or secret.`,
      });
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
  validateCountedChipFacets(where, screen.facets, entity);
}
