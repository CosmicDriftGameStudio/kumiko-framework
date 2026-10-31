import type { QueryHandlerDef } from "@cosmicdrift/kumiko-types/handlers";
import type {
  EditRelatedListSection,
  ProjectionListScreenDefinition,
} from "@cosmicdrift/kumiko-types/screen";
import {
  isListQueryWithoutSearchableFields,
  resolveEntityBehindListQuery,
} from "../entity-list-searchability.ts";
import { findEntity } from "../find-entity.ts";
import { QnTypes, qualifyEntityName } from "../qualified-name.ts";
import { isEditLayoutScreen } from "../screen-helpers.ts";
import type { FeatureDefinition } from "../types/index.ts";
import { bootRuleError } from "./boot-rule.ts";
import { SEARCHABLE_FALSE_WHITELIST } from "./entity-list-screens.ts";
import { LIST_QUERY_RULES } from "./list-query-rules.ts";
import { validateListTableAggregateQuery } from "./list-table-aggregate-query.ts";
import { NAMED_FILTER_RULES } from "./named-filter-rules.ts";
import { getZodObjectShape } from "./zod-shape.ts";

// Sibling to entity-list-screens.ts rather than an extension of it:
// validateOneEntityListScreen is typed to EntityListScreenDefinition and
// reaches into feature.entities[screen.entity] — a projectionList has no
// entity, so sharing the function would mean threading a discriminated
// union through every entity-bound helper it calls.

// Exported for query-refs.ts — one source for the QN-derivation
// logic instead of duplicating it in both boot-validators.
export function buildQueryHandlerMap(
  features: readonly FeatureDefinition[],
): ReadonlyMap<string, QueryHandlerDef> {
  const out = new Map<string, QueryHandlerDef>();
  for (const feature of features) {
    for (const [name, handler] of Object.entries(feature.queryHandlers ?? {})) {
      out.set(qualifyEntityName(feature.name, QnTypes.query, name), handler);
    }
  }
  return out;
}

// Non-ZodObject schemas (e.g. a z.union across payload shapes) and
// unresolved query handlers both fall through to "capability absent" —
// consistent with buildAppSchema's derivation, no throw either way.
function schemaAccepts(schema: QueryHandlerDef["schema"] | undefined, key: string): boolean {
  const shape = getZodObjectShape(schema);
  return shape !== undefined && key in shape;
}

// sortable/paginated are derived by buildAppSchema from the query's Zod
// schema — there is no separate wire type from the author-facing
// ProjectionListScreenDefinition, so hand-authoring them would otherwise be
// silently overwritten with no signal to the author. Reject outright.
function rejectHandAuthoredDerivedFlags(
  prefix: string,
  screen: ProjectionListScreenDefinition,
): void {
  if (screen.sortable !== undefined) {
    throw bootRuleError(LIST_QUERY_RULES.derivedFlagHandAuthored, {
      message: `${prefix}: sortable is derived from the query's Zod schema, don't set it`,
    });
  }
  if (screen.paginated !== undefined) {
    throw bootRuleError(LIST_QUERY_RULES.derivedFlagHandAuthored, {
      message: `${prefix}: paginated is derived from the query's Zod schema, don't set it`,
    });
  }
}

function validateOneProjectionListScreen(
  feature: FeatureDefinition,
  screen: ProjectionListScreenDefinition,
  queryHandlers: ReadonlyMap<string, QueryHandlerDef>,
  featureMap: ReadonlyMap<string, FeatureDefinition>,
): void {
  const prefix = `[projectionList] Feature "${feature.name}" screen "${screen.id}"`;
  const handler = queryHandlers.get(screen.query);
  const schema = handler?.schema;
  // buildAppSchema derives searchable: false for these, so no whitelist entry is needed.
  const searchDerivedOff = isListQueryWithoutSearchableFields(screen.query, handler, (name) =>
    findEntity(featureMap, name),
  );

  if (screen.searchable === true && !schemaAccepts(schema, "search")) {
    throw bootRuleError(LIST_QUERY_RULES.searchableWithoutSearchParam, {
      message: `${prefix}: searchable: true but query "${screen.query}" has no "search" parameter in its Zod schema. Add a "search" field to the query schema or remove searchable: true.`,
    });
  }

  if (screen.searchable === true && searchDerivedOff) {
    throw bootRuleError(LIST_QUERY_RULES.searchableWithoutSearchableField, {
      message: `${prefix}: searchable: true but query "${screen.query}" lists an entity with no searchable field, so a search would never match. Mark a field searchable: true on the entity or remove searchable: true.`,
    });
  }

  if (
    screen.searchable === false &&
    schemaAccepts(schema, "search") &&
    !searchDerivedOff &&
    !SEARCHABLE_FALSE_WHITELIST.has(screen.id)
  ) {
    throw bootRuleError(LIST_QUERY_RULES.searchableFalseDisablesSearch, {
      message: `${prefix}: query "${screen.query}" accepts "search" but searchable: false disables it — remove searchable: false or add "${screen.id}" to SEARCHABLE_FALSE_WHITELIST`,
    });
  }

  rejectHandAuthoredDerivedFlags(prefix, screen);

  const searchActive =
    screen.searchable !== false && !searchDerivedOff && schemaAccepts(schema, "search");
  const sortActive = schemaAccepts(schema, "sort");
  if ((searchActive || sortActive) && screen.defaultSort === undefined) {
    throw bootRuleError(LIST_QUERY_RULES.defaultSortRequired, {
      message: `${prefix}: defaultSort required when search or sort is active. Set defaultSort: { field, direction }.`,
    });
  }

  validateProjectionListFilterSchemaAcceptance(prefix, screen, schema);
  validateProjectionListFacetsSchemaAcceptance(prefix, screen, schema);
  validateProjectionListNamedFilterSchemaAcceptance(prefix, screen, schema);
  validateListTableAggregateQuery({ prefix, ...screen, handler, featureMap });
}

// filter sends `payload.filter` — same 422 footgun as facets below
// if the handler's schema doesn't accept it.
function validateProjectionListFilterSchemaAcceptance(
  prefix: string,
  screen: ProjectionListScreenDefinition,
  schema: QueryHandlerDef["schema"] | undefined,
): void {
  // skip: no filter declared, or the schema already accepts it — nothing to reject.
  if (screen.filter === undefined || schemaAccepts(schema, "filter")) return;
  throw bootRuleError(LIST_QUERY_RULES.filterParamMissing, {
    message:
      `${prefix}: declares filter but query "${screen.query}" has no "filter" parameter in its Zod ` +
      `schema — add filter: z.object({ field: z.string(), op: z.enum(["eq","ne","lt","gt","lte","gte","in"]), ` +
      `value: z.unknown() }).optional() (or reuse entityListSchema's shape) to the handler's schema.`,
  });
}

// namedFilters send `payload.namedFilter` — same 422 footgun as filter/facets.
function validateProjectionListNamedFilterSchemaAcceptance(
  prefix: string,
  screen: ProjectionListScreenDefinition,
  schema: QueryHandlerDef["schema"] | undefined,
): void {
  // skip: no named filters declared, or the schema already accepts the key — nothing to reject.
  if (screen.namedFilters === undefined || schemaAccepts(schema, "namedFilter")) return;
  throw bootRuleError(NAMED_FILTER_RULES.projectionQueryAcceptsNamedFilter, {
    message:
      `${prefix}: declares namedFilters but query "${screen.query}" has no "namedFilter" parameter in its ` +
      `Zod schema — add namedFilter: z.string().optional() to the handler's schema and resolve it with resolveNamedListFilters.`,
  });
}

// facets send `payload.filters` — same failure mode as search/sort:
// definePagedQueryHandler doesn't auto-merge params into the
// handler's own Zod schema, so a declared facet would 422 on every query
// unless the author added `filters` themselves.
// A dateRange facet sends its two bounds as the top-level payload
// keys it names in `params`, not as a `filters` entry — so the query has to
// accept exactly those keys. Catches the facet pointed at a field the query
// can't narrow by, which would otherwise 422 on the first date the user picks.
// Keys buildListQueryPayload owns — a facet param naming one of them would
// silently replace the list's own paging/sorting on every pick.
const RESERVED_LIST_PAYLOAD_KEYS: ReadonlySet<string> = new Set([
  "limit",
  "search",
  "sort",
  "sortDirection",
  "offset",
  "totalCount",
  "cursor",
  "filter",
  "filters",
]);

function validateProjectionListDateRangeFacets(
  prefix: string,
  screen: ProjectionListScreenDefinition,
  schema: QueryHandlerDef["schema"] | undefined,
): void {
  // Shared params overwrite each other in the payload, silently dropping the first pick.
  // (Two facets on one field are already rejected by the generic duplicate-facet check.)
  const usedParams = new Set<string>();
  for (const facet of screen.facets ?? []) {
    if (facet.type !== "dateRange") continue;
    if (facet.params.from === facet.params.to) {
      throw bootRuleError(LIST_QUERY_RULES.dateRangeSameParam, {
        message:
          `${prefix}: dateRange facet on "${facet.field}" names the same param ` +
          `"${facet.params.from}" for both bounds. Use two different param names for from and to.`,
      });
    }
    for (const param of [facet.params.from, facet.params.to]) {
      if (RESERVED_LIST_PAYLOAD_KEYS.has(param)) {
        throw bootRuleError(LIST_QUERY_RULES.dateRangeReservedParam, {
          message:
            `${prefix}: dateRange facet on "${facet.field}" names "${param}" as a bound, ` +
            `which is a reserved list-payload key — pick the query's own time-bound param names.`,
        });
      }
      if (usedParams.has(param)) {
        throw bootRuleError(LIST_QUERY_RULES.dateRangeParamReused, {
          message:
            `${prefix}: dateRange facet on "${facet.field}" names "${param}" which another dateRange ` +
            `facet on this screen already uses — the facets would overwrite each other's bound. Give each dateRange facet its own param names.`,
        });
      }
      usedParams.add(param);
      if (schemaAccepts(schema, param)) continue;
      throw bootRuleError(LIST_QUERY_RULES.dateRangeParamMissing, {
        message:
          `${prefix}: dateRange facet on "${facet.field}" sends "${param}" but query ` +
          `"${screen.query}" has no "${param}" parameter in its Zod schema — add ` +
          `${param}: z.iso.datetime().optional() to the handler's schema, or point ` +
          `params at the keys it already accepts.`,
      });
    }
  }
}

function validateProjectionListFacetsSchemaAcceptance(
  prefix: string,
  screen: ProjectionListScreenDefinition,
  schema: QueryHandlerDef["schema"] | undefined,
): void {
  validateProjectionListDateRangeFacets(prefix, screen, schema);
  // skip: no facets that travel via `filters` — nothing to reject.
  if (screen.facets === undefined || !screen.facets.some((f) => f.type !== "dateRange")) return;
  // skip: the schema already accepts filters — nothing to reject.
  if (schemaAccepts(schema, "filters")) return;
  throw bootRuleError(LIST_QUERY_RULES.facetsWithoutFiltersParam, {
    message:
      `${prefix}: declares facets but query "${screen.query}" has no "filters" parameter in its ` +
      `Zod schema — add filters: z.array(z.object({ field: z.string(), op: z.literal("in"), ` +
      `value: z.unknown() })).optional() (or reuse entityListSchema's shape) to the handler's schema.`,
  });
}

export function validateProjectionListScreens(features: readonly FeatureDefinition[]): void {
  const queryHandlers = buildQueryHandlerMap(features);
  const featureMap = new Map(features.map((f) => [f.name, f] as const));
  for (const feature of features) {
    for (const screen of Object.values(feature.screens)) {
      if (screen.type !== "projectionList") continue;
      validateOneProjectionListScreen(feature, screen, queryHandlers, featureMap);
    }
  }
}

function validateRelatedListSearchable(
  prefix: string,
  section: EditRelatedListSection,
  schema: QueryHandlerDef["schema"] | undefined,
): void {
  // skip: not searchable, or the schema already accepts search — nothing to reject.
  if (section.searchable !== true || schemaAccepts(schema, "search")) return;
  throw bootRuleError(LIST_QUERY_RULES.searchableWithoutSearchParam, {
    message: `${prefix}: searchable: true but query "${section.query}" has no "search" parameter in its Zod schema. Add a "search" field to the query schema or remove searchable: true.`,
  });
}

function validateRelatedListFacets(
  prefix: string,
  section: EditRelatedListSection,
  schema: QueryHandlerDef["schema"] | undefined,
): void {
  // skip: no facets declared — nothing to reject.
  if (section.facets === undefined || section.facets.length === 0) return;
  // skip: the schema already accepts filters — nothing to reject.
  if (schemaAccepts(schema, "filters")) return;
  throw bootRuleError(LIST_QUERY_RULES.facetsWithoutFiltersParam, {
    message: `${prefix}: declares facets but query "${section.query}" has no "filters" parameter in its Zod schema — add filters: z.array(z.object({ field: z.string(), op: z.literal("in"), value: z.unknown() })).optional() (or reuse entityListSchema's shape) to the handler's schema.`,
  });
}

function validateRelatedListCount(
  prefix: string,
  section: EditRelatedListSection,
  layoutMode: string | undefined,
  schema: QueryHandlerDef["schema"] | undefined,
): void {
  // skip: no count badge declared — nothing to reject.
  if (section.count !== true) return;
  if (layoutMode !== "tabs") {
    throw bootRuleError(LIST_QUERY_RULES.countNeedsTabsLayout, {
      message: `${prefix}: count: true only renders in a layout with mode "tabs".`,
    });
  }
  if (section.countField !== undefined) {
    throw bootRuleError(LIST_QUERY_RULES.countAndCountField, {
      message: `${prefix}: declares both count and countField — pick one badge source.`,
    });
  }
  for (const key of ["totalCount", "limit"]) {
    if (schemaAccepts(schema, key)) continue;
    throw bootRuleError(LIST_QUERY_RULES.countParamMissing, {
      message: `${prefix}: count: true needs query "${section.query}" to accept "${key}" in its Zod schema (the badge asks for limit: 1, totalCount: true).`,
    });
  }
}

// parentFilter lets a relatedList reuse the
// generic `<entity>:list` query instead of a bespoke child-rows handler —
// same 422 footgun as facets/filter above, plus its own mutual-exclusivity
// and field-existence checks.
function validateRelatedListParentFilter(
  prefix: string,
  section: EditRelatedListSection,
  schema: QueryHandlerDef["schema"] | undefined,
  handler: QueryHandlerDef | undefined,
  featureMap: ReadonlyMap<string, FeatureDefinition>,
): void {
  // skip: no parentFilter declared — nothing to reject.
  if (section.parentFilter === undefined) return;
  if (section.parentParam !== undefined) {
    throw bootRuleError(LIST_QUERY_RULES.parentFilterAndParentParam, {
      message:
        `${prefix}: declares both parentFilter and parentParam — parentFilter replaces the implicit ` +
        `{ [parentParam]: parentId } payload key with a server-side "filter" clause, so the two can't ` +
        `be combined. Remove parentParam or drop parentFilter.`,
    });
  }
  if (!schemaAccepts(schema, "filter")) {
    throw bootRuleError(LIST_QUERY_RULES.parentFilterParamMissing, {
      message:
        `${prefix}: declares parentFilter but query "${section.query}" has no "filter" parameter in its ` +
        `Zod schema — add filter: z.object({ field: z.string(), op: z.enum(["eq","ne","lt","gt","lte","gte","in"]), ` +
        `value: z.unknown() }).optional() (or reuse entityListSchema's shape) to the handler's schema.`,
    });
  }
  const entity = resolveEntityBehindListQuery(section.query, handler, (name) =>
    findEntity(featureMap, name),
  );
  if (entity !== undefined && entity.fields[section.parentFilter.field] === undefined) {
    throw bootRuleError(LIST_QUERY_RULES.parentFilterFieldUnknown, {
      message:
        `${prefix}: parentFilter.field "${section.parentFilter.field}" is not a declared field on the ` +
        `entity behind query "${section.query}". Known fields: ${Object.keys(entity.fields).sort().join(", ")}.`,
    });
  }
}

// relatedList sections declare search/facets the same way a projectionList
// screen does, and hit the same 422 footgun: definePagedQueryHandler doesn't
// auto-merge params into the handler's own Zod schema, so an
// undeclared param would fail every query instead of failing at boot.
// Reachable on projectionDetail only (screens.ts rejects relatedList
// elsewhere), but the layout walk stays uniform so lifting that restriction
// doesn't quietly skip these checks.
export function validateRelatedListSectionQueries(features: readonly FeatureDefinition[]): void {
  const queryHandlers = buildQueryHandlerMap(features);
  const featureMap = new Map(features.map((f) => [f.name, f] as const));
  const validateSectionQuery = (prefix: string, section: EditRelatedListSection): void => {
    const handler = queryHandlers.get(section.query);
    const schema = handler?.schema;
    validateRelatedListSearchable(prefix, section, schema);
    validateRelatedListFacets(prefix, section, schema);
    validateRelatedListParentFilter(prefix, section, schema, handler, featureMap);
    validateListTableAggregateQuery({ prefix, ...section, handler, featureMap });
  };
  for (const feature of features) {
    for (const screen of Object.values(feature.screens)) {
      if (screen.type === "entityList" && screen.expandableRow !== undefined) {
        validateSectionQuery(
          `[Feature ${feature.name}] Screen "${screen.id}" (entityList) expandableRow "${screen.expandableRow.title}"`,
          screen.expandableRow,
        );
      }
      if (!isEditLayoutScreen(screen)) continue;
      for (const section of screen.layout.sections) {
        if (section.kind !== "relatedList") continue;
        const sectionPrefix = `[Feature ${feature.name}] Screen "${screen.id}" (${screen.type}) relatedList section "${section.title}"`;
        validateSectionQuery(sectionPrefix, section);
        validateRelatedListCount(
          sectionPrefix,
          section,
          screen.layout.mode,
          queryHandlers.get(section.query)?.schema,
        );
      }
    }
  }
}
