import type { EntityDefinition } from "@cosmicdrift/kumiko-types/fields";
import { ENTITY_CONVENTION_QUERY_BRAND } from "@cosmicdrift/kumiko-types/handlers";
import { FILE_REF_ENTITY_NAME } from "../../files/types.ts";
import type { FeatureDefinition } from "../types/index.ts";
import { findEntity } from "./parent-ref.ts";

// Boot half of the read-gate guarantee (db/read-gate-clause.ts): the gate names registered
// entities and fields, and a hand-written list/detail handler cannot silently skip it.

type GateCheck = {
  readonly feature: FeatureDefinition;
  readonly featureMap: ReadonlyMap<string, FeatureDefinition>;
  readonly entityName: string;
  readonly entity: EntityDefinition;
};

function fail(check: GateCheck, message: string): never {
  throw new Error(
    `[Kumiko ReadGate] entity "${check.entityName}" (feature: "${check.feature.name}"): ${message}`,
  );
}

function validateAnyLink(check: GateCheck, anyLink: { entity: string; field: string }): void {
  const link = findEntity(check.featureMap, anyLink.entity);
  if (link === undefined) {
    fail(check, `readGate.anyLink.entity "${anyLink.entity}" is not registered.`);
  }
  if (link.parentRef === undefined) {
    fail(
      check,
      `readGate.anyLink.entity "${anyLink.entity}" must declare a parentRef; its host visibility is what the gate checks.`,
    );
  }
  if (link.fields[anyLink.field] === undefined) {
    fail(check, `readGate.anyLink.field "${anyLink.field}" is not a field of "${anyLink.entity}".`);
  }
}

function validateFileOwner(check: GateCheck, fileOwner: { field: string }): void {
  const fileField = check.entity.fields[fileOwner.field];
  if (fileField?.type !== "file" && fileField?.type !== "image") {
    fail(
      check,
      `readGate.fileOwner.field "${fileOwner.field}" must be a single file or image field.`,
    );
  }
  if (findEntity(check.featureMap, FILE_REF_ENTITY_NAME) === undefined) {
    fail(check, `readGate.fileOwner needs the files feature (entity "${FILE_REF_ENTITY_NAME}").`);
  }
}

function validateNoHandWrittenReaders(check: GateCheck): void {
  for (const verb of ["list", "detail"] as const) {
    const handlerName = `${check.entityName}:${verb}`;
    for (const f of check.featureMap.values()) {
      const handler = f.queryHandlers[handlerName];
      if (handler !== undefined && handler[ENTITY_CONVENTION_QUERY_BRAND] !== true) {
        fail(
          check,
          `query handler "${handlerName}" is hand-written and would bypass the readGate. Fix: register it via defineEntityListHandler/defineEntityDetailHandler.`,
        );
      }
    }
  }
}

export function validateReadGates(
  feature: FeatureDefinition,
  featureMap: ReadonlyMap<string, FeatureDefinition>,
): void {
  for (const [entityName, entity] of Object.entries(feature.entities ?? {})) {
    const gate = entity.readGate;
    if (gate === undefined) continue;
    const check: GateCheck = { feature, featureMap, entityName, entity };

    if (entity.parentRef !== undefined) {
      fail(
        check,
        "readGate and parentRef cannot be combined; a gated entity cannot be a join row.",
      );
    }
    if (gate.anyLink !== undefined) validateAnyLink(check, gate.anyLink);
    if (gate.fileOwner !== undefined) validateFileOwner(check, gate.fileOwner);
    validateNoHandWrittenReaders(check);
  }
}
