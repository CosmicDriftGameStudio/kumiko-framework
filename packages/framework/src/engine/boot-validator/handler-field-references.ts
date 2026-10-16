import { readHandlerFieldReference } from "../handler-field-references.js";
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
      const where = `Input field "${fieldName}" of ${handlerNoun} "${handlerName}"`;
      const reading = readHandlerFieldReference(def.schema, fieldName);
      if (reading.kind === "none") continue;
      if (reading.kind === "invalid") {
        throw new Error(
          `[Feature ${feature.name}] ${where} has an invalid meta references value ${JSON.stringify(reading.raw)}. ` +
            `Use "<entity>", "<feature>:<entity>" or { entity, by? }.`,
        );
      }
      const { entity, by } = reading.reference;
      const target = parseRefTarget(entity, feature.name);
      const targetEntity = featureMap.get(target.featureName)?.entities?.[target.entityName];
      if (targetEntity === undefined) {
        throw new Error(
          `[Feature ${feature.name}] ${where} has meta references: "${entity}", ` +
            `which is not a registered entity. Use "<entity>" for this feature or "<feature>:<entity>" for another one.`,
        );
      }
      if (by !== undefined && targetEntity.fields[by] === undefined) {
        throw new Error(
          `[Feature ${feature.name}] ${where} references entity "${entity}" by "${by}", ` +
            `but that entity has no field "${by}".`,
        );
      }
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
