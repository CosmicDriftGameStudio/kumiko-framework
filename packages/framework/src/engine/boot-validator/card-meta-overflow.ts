import { CARD_META_MAX, cardColumnRoles } from "../../ui-types/card-column-roles.js";
import { LIST_ROW_META_COLUMNS } from "../../ui-types/list-row-meta.js";
import { parseRefTarget } from "../parse-ref-target.js";
import { normalizeListColumn } from "../screen-helpers.js";
import type {
  EditRelatedListSection,
  EntityDefinition,
  FeatureDefinition,
  ListColumnSpec,
} from "../types/index.js";

export type CardMetaOverflow = {
  readonly feature: string;
  readonly screen: string;
  readonly location?: string;
  readonly count: number;
  readonly fields: readonly string[];
};

// Mirrors the type resolution of headless computeListViewModel; only the
// "select" outcome matters for the card status role.
function resolveColumnType(
  spec: ListColumnSpec,
  storedType: string | undefined,
  entity: EntityDefinition | undefined,
): string {
  const col = normalizeListColumn(spec);
  if (col.refEntity !== undefined && (storedType === undefined || storedType === "text")) {
    return "reference";
  }
  if (storedType !== undefined) return storedType;
  const derived = entity?.derivedFields?.[col.field];
  if (derived !== undefined) return derived.valueType;
  return LIST_ROW_META_COLUMNS[col.field] ?? "text";
}

function countOverflow(
  feature: FeatureDefinition,
  screen: string,
  location: string | undefined,
  columns: readonly ListColumnSpec[],
  storedTypeOf: (field: string) => string | undefined,
  entity: EntityDefinition | undefined,
): CardMetaOverflow | undefined {
  const cardColumns = columns.map((spec) => {
    const col = normalizeListColumn(spec);
    return {
      field: col.field,
      type: resolveColumnType(spec, storedTypeOf(col.field), entity),
      renderer: col.renderer,
      hideOnNarrow: col.hideOnNarrow,
    };
  });
  const { meta } = cardColumnRoles(cardColumns);
  if (meta.length <= CARD_META_MAX) return undefined;
  return {
    feature: feature.name,
    screen,
    ...(location !== undefined && { location }),
    count: meta.length,
    fields: meta.map((col) => col.field),
  };
}

function relatedListOverflow(
  features: readonly FeatureDefinition[],
  feature: FeatureDefinition,
  screen: string,
  location: string,
  section: Pick<EditRelatedListSection, "columns" | "entity">,
): CardMetaOverflow | undefined {
  let source: EntityDefinition | undefined;
  if (section.entity !== undefined) {
    const target = parseRefTarget(section.entity, feature.name);
    source = features.find((f) => f.name === target.featureName)?.entities?.[target.entityName];
  }
  const synthesizedTypes = new Map(
    section.columns.map((spec) => {
      const col = normalizeListColumn(spec);
      return [col.field, col.valueType ?? "text"] as const;
    }),
  );
  return countOverflow(
    feature,
    screen,
    location,
    section.columns,
    (field) => source?.fields[field]?.type ?? synthesizedTypes.get(field),
    source,
  );
}

// Every declaration whose columns the narrow layout draws as a DataTable card.
// Dashboard list panels have their own table and are not covered.
export function collectCardMetaOverflow(
  features: readonly FeatureDefinition[],
): readonly CardMetaOverflow[] {
  const found: CardMetaOverflow[] = [];
  const add = (overflow: CardMetaOverflow | undefined) => {
    if (overflow !== undefined) found.push(overflow);
  };
  for (const feature of features) {
    for (const screen of Object.values(feature.screens)) {
      if (screen.type === "entityList") {
        const entity = feature.entities?.[screen.entity];
        add(
          countOverflow(
            feature,
            screen.id,
            undefined,
            screen.columns,
            (field) => entity?.fields[field]?.type,
            entity,
          ),
        );
        if (screen.expandableRow !== undefined) {
          add(
            relatedListOverflow(
              features,
              feature,
              screen.id,
              `expandableRow "${screen.expandableRow.title}"`,
              screen.expandableRow,
            ),
          );
        }
      } else if (screen.type === "projectionList") {
        // The projection shim types every column "text"; only refEntity changes it.
        add(countOverflow(feature, screen.id, undefined, screen.columns, () => "text", undefined));
      } else if (screen.type === "projectionDetail") {
        const isTabs = screen.layout.mode === "tabs";
        for (const section of screen.layout.sections) {
          if (!("kind" in section) || section.kind !== "relatedList") continue;
          const location = isTabs
            ? `tab "${section.id ?? section.title}" section "${section.title}"`
            : `section "${section.title}"`;
          add(relatedListOverflow(features, feature, screen.id, location, section));
        }
      }
    }
  }
  return found;
}

export function validateCardMetaOverflow(features: readonly FeatureDefinition[]): void {
  const overflows = collectCardMetaOverflow(features);
  // skip: nothing overflows, so there is nothing to report
  if (overflows.length === 0) return;
  const lines = overflows.map(
    (o) =>
      `  - Feature "${o.feature}" screen "${o.screen}"${o.location !== undefined ? ` ${o.location}` : ""}: ${o.count} meta columns (${o.fields.join(", ")})`,
  );
  throw new Error(
    `List cards show at most ${CARD_META_MAX} meta columns (all columns except title, status select and hideOnNarrow ones); more would be cut off on narrow screens:\n${lines.join("\n")}\nReduce each to ${CARD_META_MAX} columns or mark the others hideOnNarrow: true.`,
  );
}
