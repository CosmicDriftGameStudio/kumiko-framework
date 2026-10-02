import {
  EXT_EXTERNAL_RESOURCE,
  EXT_INFRA_RESOURCE,
  EXT_SEARCH_ADAPTER,
  EXT_STORAGE_PROVIDER,
  EXT_TENANT_DATA,
  type FeatureDefinition,
  isTenantDataExtensionHooks,
  isTenantResourceExtensionHooks,
  type ResolvedPiiFlags,
} from "@cosmicdrift/kumiko-framework/engine";
import { entitiesOf } from "../shared/index.js";

// V4: tenantOwned-entity-without-hook gate. Mirrors user-data-rights' V3
// (validateGdprPiiHookCoverage) but for EXT_TENANT_DATA. Registered as this
// feature's own `r.bootCheck()` (#1314, moved off the framework-internal
// boot-validator) — tenant-lifecycle owns EXT_TENANT_DATA
// (r.extendsRegistrar), so its own mount is the trigger, matching the
// original guard's "tenant-lifecycle mounted" gate exactly (unlike gating on
// a sibling feature, which would silently narrow coverage).

function hasTenantOwned(field: unknown): field is ResolvedPiiFlags {
  return (
    typeof field === "object" &&
    field !== null &&
    "tenantOwned" in field &&
    (field as { tenantOwned?: unknown }).tenantOwned === true
  );
}

export function validateTenantDataHookCoverage(features: readonly FeatureDefinition[]): void {
  const hookedEntities = new Set<string>();
  for (const f of features) {
    for (const usage of f.extensionUsages) {
      if (usage.extensionName === EXT_TENANT_DATA) hookedEntities.add(usage.entityName);
    }
  }

  for (const feature of features) {
    for (const [entityName, entity] of entitiesOf(feature)) {
      if (hookedEntities.has(entityName)) continue;
      const tenantSubjectFields = Object.entries(entity.fields)
        .filter(([, field]) => hasTenantOwned(field))
        .map(([name]) => name);
      if (tenantSubjectFields.length === 0) continue;
      throw new Error(
        `[kumiko:boot] Entity "${entityName}" (feature "${feature.name}") has tenant-subject fields (${tenantSubjectFields.join(", ")}) but no feature registers an EXT_TENANT_DATA destroy hook for it — tenant destroy never erases this data. Register r.useExtension(EXT_TENANT_DATA, "${entityName}", { destroy }) or a documented no-op if crypto-shredding covers it.`,
      );
    }
  }
}

const TENANT_RESOURCE_EXTENSIONS: ReadonlySet<string> = new Set([
  EXT_STORAGE_PROVIDER,
  EXT_SEARCH_ADAPTER,
  EXT_EXTERNAL_RESOURCE,
  EXT_INFRA_RESOURCE,
]);

// Malformed destroy registrations would otherwise only throw when a tenant
// destruction reaches the stage, possibly months after deploy, and stall the
// whole pipeline (stages.ts keeps its own throw as defense in depth). JS
// plugins and `as` casts slip past the type check.
export function validateTenantDestroyHookShapes(features: readonly FeatureDefinition[]): void {
  for (const feature of features) {
    for (const usage of feature.extensionUsages) {
      const isTenantData = usage.extensionName === EXT_TENANT_DATA;
      if (!isTenantData && !TENANT_RESOURCE_EXTENSIONS.has(usage.extensionName)) continue;
      const isValid = isTenantData
        ? isTenantDataExtensionHooks(usage.options)
        : isTenantResourceExtensionHooks(usage.options);
      if (isValid) continue;
      const requiredFn = isTenantData ? "destroy" : "destroyTenant";
      throw new Error(
        `[kumiko:boot] ${usage.extensionName} registration for "${usage.entityName}" (feature "${feature.name}") has no ${requiredFn} function — tenant destroy would fail at this stage.`,
      );
    }
  }
}
