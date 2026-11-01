import type { WebhookEntityVerb, WebhookEventContract } from "@cosmicdrift/kumiko-types/feature";
import type { EntityDefinition, FieldDefinition } from "@cosmicdrift/kumiko-types/fields";
import * as z from "zod";
import { DEFAULT_CURRENCIES } from "./field-helpers.ts";
import { personalFieldNames } from "./personal-data-fields.ts";
import { fieldToZod } from "./schema-builder.ts";
import type { FeatureDefinition } from "./types/index.ts";

const ENTITY_VERBS: readonly WebhookEntityVerb[] = ["created", "updated", "deleted"];
const CONTRACT_VERSION = 1;

// money and locatedTimestamp are stored as several flat columns (amount plus currency, instant
// plus zone); the event shape of such a field is not mapped yet, so they stay out instead of
// being described wrongly.
const COMPOUND_FIELD_TYPES: ReadonlySet<FieldDefinition["type"]> = new Set([
  "money",
  "locatedTimestamp",
]);

function isEncryptedText(field: FieldDefinition): boolean {
  return (field.type === "text" || field.type === "longText") && field.encrypted === true;
}

function isSecretText(field: FieldDefinition): boolean {
  return field.type === "text" && field.writeOnly === true;
}

function isSensitive(field: FieldDefinition): boolean {
  return "sensitive" in field && field.sensitive === true;
}

function releasableFields(
  entity: EntityDefinition,
  excludedFields: ReadonlySet<string>,
): readonly (readonly [string, FieldDefinition])[] {
  const personal = personalFieldNames(entity, false);
  return Object.entries(entity.fields).filter(
    ([name, field]) =>
      !personal.has(name) &&
      !excludedFields.has(name) &&
      !COMPOUND_FIELD_TYPES.has(field.type) &&
      !isEncryptedText(field) &&
      !isSecretText(field) &&
      !isSensitive(field),
  );
}

function isAlwaysPresent(field: FieldDefinition): boolean {
  return (
    ("required" in field && field.required === true) ||
    ("default" in field && field.default !== undefined)
  );
}

function fieldShape(
  fields: readonly (readonly [string, FieldDefinition])[],
  presence: "as-declared" | "optional",
): Record<string, z.ZodType> {
  return Object.fromEntries(
    fields.map(([name, field]) => {
      const schema = fieldToZod(field, DEFAULT_CURRENCIES, { applyDefaults: false });
      const required = presence === "as-declared" && isAlwaysPresent(field);
      return [name, required ? schema : schema.nullable().optional()];
    }),
  );
}

// The executor appends `changes` and `previous` (the whole pre-update row, which always has `id`)
// on update and `{ previous }` on delete; create appends the flat fields without `id`. Receivers
// need the id, so the contract carries it on the top level; `toEntityWebhookPayload` takes it from
// the event's aggregate id.
function payloadFor(
  verb: WebhookEntityVerb,
  fields: readonly (readonly [string, FieldDefinition])[],
): z.ZodObject {
  const row = z.object({ id: z.uuid(), ...fieldShape(fields, "optional") });
  if (verb === "created") return z.object({ id: z.uuid(), ...fieldShape(fields, "as-declared") });
  if (verb === "updated")
    return z.object({
      id: z.uuid(),
      changes: z.object(fieldShape(fields, "optional")),
      previous: row,
    });
  return z.object({ id: z.uuid(), previous: row });
}

const VERB_DESCRIPTION: Readonly<Record<WebhookEntityVerb, string>> = {
  created: "was created",
  updated: "was updated",
  deleted: "was deleted",
};

function entityContract(
  entityName: string,
  verb: WebhookEntityVerb,
  entity: EntityDefinition,
  excludedFields: ReadonlySet<string>,
): WebhookEventContract {
  return {
    qn: `${entityName}.${verb}`,
    description: `A ${entityName} ${VERB_DESCRIPTION[verb]}.`,
    payload: payloadFor(verb, releasableFields(entity, excludedFields)),
    version: CONTRACT_VERSION,
    origin: "entity",
    entity: entityName,
    verb,
  };
}

function excludedFieldsByEntity(
  features: readonly FeatureDefinition[],
): ReadonlyMap<string, ReadonlySet<string>> {
  const byEntity = new Map<string, Set<string>>();
  for (const feature of features) {
    for (const [handlerName, handler] of Object.entries(feature.writeHandlers)) {
      const entityName = feature.handlerEntityMappings[handlerName];
      if (entityName === undefined || handler.excludedFields === undefined) continue;
      const names = byEntity.get(entityName) ?? new Set<string>();
      for (const field of handler.excludedFields) names.add(field);
      byEntity.set(entityName, names);
    }
  }
  return byEntity;
}

function entityVerbOf(
  qualifiedName: string,
): { entity: string; verb: WebhookEntityVerb } | undefined {
  const dot = qualifiedName.lastIndexOf(".");
  if (dot <= 0) return undefined;
  const verb = ENTITY_VERBS.find((candidate) => candidate === qualifiedName.slice(dot + 1));
  return verb === undefined ? undefined : { entity: qualifiedName.slice(0, dot), verb };
}

export type WebhookContractResolver = {
  /** Declared contract, or one derived from an entity lifecycle event (`entity.verb`). */
  get(qualifiedName: string): WebhookEventContract | undefined;
  /** Declared contracts only, sorted by QN. */
  declared(): readonly WebhookEventContract[];
};

/** Works on the feature list so a boot check, which has no registry, resolves the same contracts. */
export function createWebhookContractResolver(
  features: readonly FeatureDefinition[],
): WebhookContractResolver {
  const declared = new Map<string, WebhookEventContract>();
  const entities = new Map<string, EntityDefinition>();
  for (const feature of features) {
    for (const def of Object.values(feature.webhookEvents ?? {})) {
      declared.set(def.qn, { ...def, origin: "declared" });
    }
    for (const [name, entity] of Object.entries(feature.entities ?? {})) entities.set(name, entity);
  }
  const excluded = excludedFieldsByEntity(features);
  const derived = new Map<string, WebhookEventContract | undefined>();

  return {
    get(qualifiedName) {
      const own = declared.get(qualifiedName);
      if (own !== undefined) return own;
      if (!derived.has(qualifiedName)) {
        const target = entityVerbOf(qualifiedName);
        const entity = target === undefined ? undefined : entities.get(target.entity);
        derived.set(
          qualifiedName,
          target === undefined || entity === undefined
            ? undefined
            : entityContract(
                target.entity,
                target.verb,
                entity,
                excluded.get(target.entity) ?? new Set(),
              ),
        );
      }
      return derived.get(qualifiedName);
    },
    declared() {
      return [...declared.values()].sort((a, b) => (a.qn < b.qn ? -1 : a.qn > b.qn ? 1 : 0));
    },
  };
}
