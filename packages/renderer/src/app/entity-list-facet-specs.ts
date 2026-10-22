import { parseRefTarget } from "@cosmicdrift/kumiko-framework/ui-types";
import { propertyOf } from "@cosmicdrift/kumiko-types/type-guards";
import type { Translate } from "../headless/index.ts";
import { fieldLabelKey, fieldOptionLabelKey } from "../headless/index.ts";
import type { ResolvedFacetSpec } from "./list-facets.ts";

// entityList adapter — one DataTableFacet per filterable select/boolean
// entity field, labels via the standard field/option i18n convention.
export function resolveEntityFacetSpecs(
  fields: Readonly<Record<string, unknown>>,
  featureName: string,
  entityName: string,
  translate: Translate,
): ResolvedFacetSpec[] {
  const out: ResolvedFacetSpec[] = [];
  for (const [field, rawDef] of Object.entries(fields)) {
    // entity.fields is weakly typed at the renderer layer (deserialized from the schema).
    const def = {
      type: propertyOf(rawDef, "type"),
      filterable: propertyOf(rawDef, "filterable"),
      options: propertyOf(rawDef, "options"),
      entity: propertyOf(rawDef, "entity"),
      labelField: propertyOf(rawDef, "labelField"),
    };
    if (def.filterable !== true) continue;
    const label = translate(fieldLabelKey(featureName, entityName, field));
    if (def.type === "select" && Array.isArray(def.options)) {
      const optionValues = def.options.filter(
        (value): value is string => typeof value === "string",
      );
      out.push({
        field,
        type: "select",
        label,
        options: optionValues.map((value) => ({
          value,
          label: translate(fieldOptionLabelKey(featureName, entityName, field, value)),
        })),
      });
    } else if (def.type === "boolean") {
      out.push({
        field,
        type: "boolean",
        label,
        options: [
          {
            value: "true",
            label: translate(fieldOptionLabelKey(featureName, entityName, field, "true")),
          },
          {
            value: "false",
            label: translate(fieldOptionLabelKey(featureName, entityName, field, "false")),
          },
        ],
      });
    } else if (def.type === "reference" && typeof def.entity === "string") {
      const target = parseRefTarget(def.entity, featureName);
      out.push({
        field,
        type: "reference",
        label,
        options: [],
        reference: {
          refEntity: target.entityName,
          refFeature: target.featureName,
          labelField: typeof def.labelField === "string" ? def.labelField : "id",
        },
      });
    }
  }
  return out;
}
