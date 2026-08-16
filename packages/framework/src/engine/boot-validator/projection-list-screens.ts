import { ZodObject } from "zod";
import { QnTypes, qualifyEntityName } from "../qualified-name";
import type { FeatureDefinition, ProjectionListScreenDefinition, QueryHandlerDef } from "../types";
import { SEARCHABLE_FALSE_WHITELIST } from "./entity-list-screens";

// Sibling to entity-list-screens.ts rather than an extension of it:
// validateOneEntityListScreen is typed to EntityListScreenDefinition and
// reaches into feature.entities[screen.entity] — a projectionList has no
// entity, so sharing the function would mean threading a discriminated
// union through every entity-bound helper it calls.

function buildQueryHandlerMap(
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
  const shape = schema instanceof ZodObject ? schema.shape : undefined;
  return shape !== undefined && key in shape;
}

function validateOneProjectionListScreen(
  feature: FeatureDefinition,
  screen: ProjectionListScreenDefinition,
  queryHandlers: ReadonlyMap<string, QueryHandlerDef>,
): void {
  const prefix = `[projectionList] Feature "${feature.name}" screen "${screen.id}"`;
  const schema = queryHandlers.get(screen.query)?.schema;

  if (screen.searchable === true && !schemaAccepts(schema, "search")) {
    throw new Error(
      `${prefix}: searchable: true but query "${screen.query}" has no "search" parameter in its Zod schema`,
    );
  }

  if (
    screen.searchable === false &&
    schemaAccepts(schema, "search") &&
    !SEARCHABLE_FALSE_WHITELIST.has(screen.id)
  ) {
    throw new Error(
      `${prefix}: query "${screen.query}" accepts "search" but searchable: false disables it — remove searchable: false or add "${screen.id}" to SEARCHABLE_FALSE_WHITELIST`,
    );
  }

  // sortable/paginated are derived by buildAppSchema from the query's Zod
  // schema (fw#2165) — there is no separate wire type from the author-facing
  // ProjectionListScreenDefinition, so hand-authoring them would otherwise be
  // silently overwritten with no signal to the author. Reject outright.
  if (screen.sortable !== undefined) {
    throw new Error(`${prefix}: sortable is derived from the query's Zod schema, don't set it`);
  }
  if (screen.paginated !== undefined) {
    throw new Error(`${prefix}: paginated is derived from the query's Zod schema, don't set it`);
  }

  const searchActive = screen.searchable !== false && schemaAccepts(schema, "search");
  const sortActive = schemaAccepts(schema, "sort");
  if ((searchActive || sortActive) && screen.defaultSort === undefined) {
    throw new Error(`${prefix}: defaultSort required when search or sort is active`);
  }
}

export function validateProjectionListScreens(features: readonly FeatureDefinition[]): void {
  const queryHandlers = buildQueryHandlerMap(features);
  for (const feature of features) {
    for (const screen of Object.values(feature.screens)) {
      if (screen.type !== "projectionList") continue;
      validateOneProjectionListScreen(feature, screen, queryHandlers);
    }
  }
}
