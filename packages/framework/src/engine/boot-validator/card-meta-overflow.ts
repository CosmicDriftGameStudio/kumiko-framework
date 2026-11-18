import type { EntityDefinition } from "@cosmicdrift/kumiko-types/fields";
import type {
  EditLayout,
  EditRelatedListSection,
  EntityListScreenDefinition,
  ListColumnSpec,
} from "@cosmicdrift/kumiko-types/screen";
import {
  CARD_META_MAX,
  cardColumnRoles,
  cardFileDisplayKind,
  cardMetaLines,
} from "../../ui-types/card-column-roles.ts";
import { LIST_ROW_META_COLUMNS } from "../../ui-types/list-row-meta.ts";
import { parseRefTarget } from "../parse-ref-target.ts";
import {
  isFieldsEditSection,
  normalizeEditField,
  normalizeListColumn,
  sectionFieldSpecs,
} from "../screen-helpers.ts";
import type { FeatureDefinition } from "../types/index.ts";
import { bootRuleError } from "./boot-rule.ts";
import type { BootWarningSink } from "./boot-warning.ts";
import { CARD_META_OVERFLOW_RULES } from "./card-meta-overflow-rules.ts";

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
    const type = resolveColumnType(spec, storedTypeOf(col.field), entity);
    const fileKind = cardFileDisplayKind(type, col.renderer);
    return {
      field: col.field,
      type,
      renderer: col.renderer,
      hideOnNarrow: col.hideOnNarrow,
      narrowInline: col.narrowInline,
      cardBadge: col.cardBadge,
      cardAbove: col.cardAbove,
      hint: col.hint,
      emphasis: col.emphasis,
      ...(fileKind !== undefined && { fileDisplay: { kind: fileKind } }),
    };
  });
  // The card draws `cardAbove` columns above the title, not as meta lines.
  const meta = cardColumnRoles(cardColumns).meta.filter((col) => col.cardAbove !== true);
  const lineCount = cardMetaLines(meta).length;
  if (lineCount <= CARD_META_MAX) return undefined;
  return {
    feature: feature.name,
    screen,
    ...(location !== undefined && { location }),
    count: lineCount,
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
      `  - Feature "${o.feature}" screen "${o.screen}"${o.location !== undefined ? ` ${o.location}` : ""}: ${o.count} meta lines from the columns ${o.fields.join(", ")}`,
  );
  throw bootRuleError(CARD_META_OVERFLOW_RULES.overflow, {
    message: `List cards show at most ${CARD_META_MAX} meta lines (all columns except title, status select and hideOnNarrow ones, consecutive narrowInline columns sharing one line); more would be cut off on narrow screens:\n${lines.join("\n")}\nReduce each to ${CARD_META_MAX} lines or mark the other columns hideOnNarrow: true.`,
  });
}

function editLayoutShowsField(layout: EditLayout, field: string): boolean {
  return layout.sections.some(
    (section) =>
      isFieldsEditSection(section) &&
      sectionFieldSpecs(section).some((spec) => normalizeEditField(spec).field === field),
  );
}

// Follows the renderer's row-click targets (create-app hasRowClickTarget) except the
// app-wide createKumikoApp onRowClick, which is client code the boot never sees: a rowClick
// action, a `detailFor` screen, or an entityEdit screen that shows the file field.
function rowOpensRecordWithField(
  features: readonly FeatureDefinition[],
  screen: EntityListScreenDefinition,
  field: string,
): boolean {
  if (screen.rowActions?.some((action) => "rowClick" in action && action.rowClick === true)) {
    return true;
  }
  return features.some((feature) =>
    Object.values(feature.screens).some(
      (other) =>
        ("detailFor" in other && other.detailFor === screen.entity) ||
        (other.type === "entityEdit" &&
          other.entity === screen.entity &&
          editLayoutShowsField(other.layout, field)),
    ),
  );
}

// A phone card drops hideOnNarrow columns; when the row opens nothing either, the
// file in such a column cannot be reached on a phone at all. A reference column to an
// entity holding the file is not counted: its cell shows the label only, never a file link.
export function warnOnUnreachableHiddenFileColumns(
  warn: BootWarningSink,
  features: readonly FeatureDefinition[],
): void {
  for (const feature of features) {
    for (const screen of Object.values(feature.screens)) {
      if (screen.type !== "entityList") continue;
      const entity = feature.entities?.[screen.entity];
      const hiddenFileFields = screen.columns
        .map((spec) => normalizeListColumn(spec))
        .filter(
          (col) =>
            col.hideOnNarrow === true &&
            cardFileDisplayKind(entity?.fields[col.field]?.type, col.renderer) === "file" &&
            !rowOpensRecordWithField(features, screen, col.field),
        )
        .map((col) => col.field);
      if (hiddenFileFields.length === 0) continue;
      warn({
        kind: "list/hidden-file-column",
        feature: feature.name,
        message: `Feature "${feature.name}" screen "${screen.id}": the file column(s) ${hiddenFileFields.join(", ")} are hideOnNarrow and the row opens no record showing them, so a phone cannot reach the file. Drop hideOnNarrow, or add a rowClick action, a detail screen or the field to the edit screen. An app-wide createKumikoApp onRowClick is not visible here; ignore this warning if it opens the file.`,
      });
    }
  }
}
