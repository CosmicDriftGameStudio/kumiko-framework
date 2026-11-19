import { isFileField } from "../field-helpers.ts";
import type { FeatureDefinition } from "../types/index.ts";
import { bootRuleError } from "./boot-rule.ts";
import { ENTITY_DECLARATION_RULES } from "./entity-declaration-rules.ts";
import { KEEP_FOR_PATTERN } from "./pii-retention.ts";

// Pruned events are gone for every reader: a projection outside the entity's own table would lose
// their contribution on its next rebuild, so only the entity's own table may read them.
function findForeignEventReader(
  features: readonly FeatureDefinition[],
  entityName: string,
): string | undefined {
  const eventPrefix = `${entityName}.`;
  for (const feature of features) {
    for (const projection of Object.values(feature.projections)) {
      if (projection.isImplicit === true) continue;
      const sources = [projection.source, projection.extraSources ?? []].flat();
      if (sources.includes(entityName))
        return `r.projection "${projection.name}" (${feature.name})`;
    }
    for (const msp of Object.values(feature.multiStreamProjections)) {
      if (msp.table === undefined) continue;
      if (Object.keys(msp.apply).some((eventType) => eventType.startsWith(eventPrefix))) {
        return `r.multiStreamProjection "${msp.name}" (${feature.name})`;
      }
    }
  }
  return undefined;
}

export function validateStreamRetention(
  feature: FeatureDefinition,
  features: readonly FeatureDefinition[],
): void {
  for (const [entityName, entity] of Object.entries(feature.entities ?? {})) {
    const streamRetention = entity.streamRetention;
    if (streamRetention === undefined) continue;
    const subject = `[Feature ${feature.name}] entity "${entityName}" declares streamRetention`;

    if (!KEEP_FOR_PATTERN.test(streamRetention.keepFor)) {
      throw bootRuleError(ENTITY_DECLARATION_RULES.streamRetentionKeepFor, {
        message: `${subject} with keepFor="${streamRetention.keepFor}". Expected <number><h|d|w|m|y>, e.g. "30d".`,
      });
    }
    if (entity.retention !== undefined) {
      throw bootRuleError(ENTITY_DECLARATION_RULES.streamRetentionWithRowRetention, {
        message: `${subject} and retention. Pruning the stream would undercut the row retention; keep only one of them.`,
      });
    }
    if (entity.systemStream === true || entity.idType === "serial") {
      throw bootRuleError(ENTITY_DECLARATION_RULES.streamRetentionStreamShape, {
        message: `${subject} but has systemStream or idType "serial". The row cleanup matches rows to streams by tenant and uuid id.`,
      });
    }
    const fileFieldName = Object.entries(entity.fields).find(([, field]) =>
      isFileField(field),
    )?.[0];
    if (fileFieldName !== undefined) {
      throw bootRuleError(ENTITY_DECLARATION_RULES.streamRetentionFileField, {
        message: `${subject} but field "${fileFieldName}" holds files. Pruning would leave the file bytes behind.`,
      });
    }
    const reader = findForeignEventReader(features, entityName);
    if (reader !== undefined) {
      throw bootRuleError(ENTITY_DECLARATION_RULES.streamRetentionForeignReader, {
        message: `${subject} but ${reader} reads its events. That read model would change on its next rebuild once the events are pruned.`,
      });
    }
  }
}
