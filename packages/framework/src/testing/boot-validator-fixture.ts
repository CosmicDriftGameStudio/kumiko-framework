import type {
  EntityDefinition,
  EntityListScreenDefinition,
  FeatureDefinition,
  TranslationEntry,
} from "../engine/types";
import { normalizeListColumn } from "../engine/types/screen";
import { featureHasI18nSurface, requiredKeysFromFeature } from "../i18n/required-surface-keys";

const SEARCHABLE_FALSE_WHITELIST = new Set(["download-attempt-list"]);

function ensureEntityListSortable(feature: FeatureDefinition): FeatureDefinition {
  if (!feature.entities) return feature;
  const entities: Record<string, EntityDefinition> = { ...feature.entities };

  for (const screen of Object.values(feature.screens)) {
    if (screen.type !== "entityList") continue;
    const entity = entities[screen.entity];
    if (!entity) continue;

    const hasSortable = Object.values(entity.fields).some(
      (field) => "sortable" in field && field.sortable === true,
    );
    if (hasSortable) continue;

    const firstCol = screen.columns[0];
    if (firstCol === undefined) continue;
    const fieldName = normalizeListColumn(firstCol).field;
    const fieldDef = entity.fields[fieldName];
    if (fieldDef === undefined) continue;

    if (fieldDef.type !== "text" && fieldDef.type !== "number") continue;

    entities[screen.entity] = {
      ...entity,
      fields: {
        ...entity.fields,
        [fieldName]: { ...fieldDef, sortable: true },
      },
    };
  }

  return { ...feature, entities };
}

function ensureEntityListRowNavigation(
  feature: FeatureDefinition,
  screen: EntityListScreenDefinition,
): EntityListScreenDefinition {
  const hasEdit = Object.values(feature.screens).some(
    (s) => s.type === "entityEdit" && s.entity === screen.entity,
  );
  if (!hasEdit) return screen;
  const hasNavigate = (screen.rowActions ?? []).some(
    (a) => a.kind === "navigate" && (a.id === "view" || a.id === "edit"),
  );
  if (hasNavigate) return screen;
  const editScreen = Object.values(feature.screens).find(
    (s) => s.type === "entityEdit" && s.entity === screen.entity,
  );
  if (editScreen === undefined) return screen;
  return {
    ...screen,
    rowActions: [
      ...(screen.rowActions ?? []),
      {
        kind: "navigate",
        id: "edit",
        label: "stub:edit",
        screen: editScreen.id,
        params: { pick: ["id"] },
      },
    ],
  };
}

function defaultSortForEntityList(
  feature: FeatureDefinition,
  screen: EntityListScreenDefinition,
): EntityListScreenDefinition {
  if (screen.defaultSort !== undefined || screen.searchable === false) return screen;
  if (SEARCHABLE_FALSE_WHITELIST.has(screen.id)) return screen;

  const entity = feature.entities?.[screen.entity];
  const sortableColumn = screen.columns.map(normalizeListColumn).find((col) => {
    const fieldDef = entity?.fields[col.field];
    return fieldDef !== undefined && "sortable" in fieldDef && fieldDef.sortable === true;
  });
  if (sortableColumn === undefined) return screen;

  return { ...screen, defaultSort: { field: sortableColumn.field, dir: "asc" as const } };
}

function stubTranslations(feature: FeatureDefinition): FeatureDefinition {
  if (!featureHasI18nSurface(feature)) return feature;
  const keys: Record<string, TranslationEntry> = {
    ...Object.fromEntries(
      Object.entries(feature.translations ?? {}).map(([key, value]) => [key, { ...value }]),
    ),
  };
  for (const key of requiredKeysFromFeature(feature)) {
    if (keys[key] === undefined) keys[key] = { de: "stub", en: "stub" };
  }
  return { ...feature, translations: keys };
}

/** Test-fixture helper: satisfy entityList + i18n boot rules without bloating every makeFeature. */
export function withBootValidatorFixture(
  features: readonly FeatureDefinition[],
): FeatureDefinition[] {
  return features.map((feature) => {
    const sortable = ensureEntityListSortable(feature);
    const screens = Object.fromEntries(
      Object.entries(sortable.screens).map(([id, screen]) => {
        if (screen.type !== "entityList") return [id, screen];
        const withDefaults = defaultSortForEntityList(sortable, screen);
        return [id, ensureEntityListRowNavigation(sortable, withDefaults)];
      }),
    );
    return stubTranslations({ ...sortable, screens });
  });
}
