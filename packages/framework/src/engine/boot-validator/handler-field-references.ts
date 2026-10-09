import { handlerFieldReference } from "../handler-field-references.js";
import { parseRefTarget } from "../parse-ref-target.js";
import type { FeatureDefinition, QueryHandlerDef, WriteHandlerDef } from "../types/index.js";
import { getZodObjectShape } from "./zod-shape.js";

function validateHandlerGroup(
  feature: FeatureDefinition,
  featureMap: ReadonlyMap<string, FeatureDefinition>,
  handlers: Readonly<Record<string, WriteHandlerDef | QueryHandlerDef>>,
  handlerNoun: string,
): void {
  for (const [handlerName, def] of Object.entries(handlers)) {
    const shape = getZodObjectShape(def.schema);
    if (shape === undefined) continue;
    for (const fieldName of Object.keys(shape)) {
      const reference = handlerFieldReference(def.schema, fieldName);
      if (reference === undefined) continue;
      const target = parseRefTarget(reference, feature.name);
      const targetEntities = featureMap.get(target.featureName)?.entities;
      if (targetEntities?.[target.entityName] !== undefined) continue;
      throw new Error(
        `[Feature ${feature.name}] Input field "${fieldName}" of ${handlerNoun} "${handlerName}" has meta references: "${reference}", ` +
          `which is not a registered entity. Use "<entity>" for this feature or "<feature>:<entity>" for another one.`,
      );
    }
  }
}

export function validateHandlerFieldReferences(
  feature: FeatureDefinition,
  featureMap: ReadonlyMap<string, FeatureDefinition>,
): void {
  validateHandlerGroup(feature, featureMap, feature.writeHandlers ?? {}, "write handler");
  validateHandlerGroup(feature, featureMap, feature.queryHandlers ?? {}, "query handler");
}
