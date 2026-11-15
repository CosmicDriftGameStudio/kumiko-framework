import type { Registry } from "@cosmicdrift/kumiko-framework/engine";
import { isPlainObject, propertyOf } from "@cosmicdrift/kumiko-types/type-guards";
import { isVariantSlugOf, VARIANT_KIND } from "./template-variants.ts";
import { SYSTEM_TENANT_ID, TENANT_LAYOUT_SLUG_PREFIX } from "./web/constants.ts";
import { TEMPLATE_RESOLVER_FEATURE } from "./web/qualified-names.ts";

type DeliveryTarget = { readonly kind: string; readonly slug: string };
type PolicyEntry = DeliveryTarget & { readonly variants?: true };

// An entry covers its own slug and, with `variants`, the `<slug>:<name>` variants of a PDF template.
export function findPolicyEntry<Entry extends PolicyEntry>(
  entries: readonly Entry[],
  target: DeliveryTarget,
): Entry | undefined {
  return entries.find(
    (entry) =>
      entry.kind === target.kind &&
      (entry.slug === target.slug ||
        (entry.variants === true &&
          entry.kind === VARIANT_KIND &&
          isVariantSlugOf(target.slug, entry.slug))),
  );
}

// What decides whether a tenant row may be served. Independent of who reads: delivery must not
// change with the caller's roles, so this is not the edit policy.
export type TemplateDeliveryPolicy = {
  readonly tenantEditable: readonly PolicyEntry[];
  /** Kinds of collections mounted with an explicit `access`; their tenant rows are edited by design. */
  readonly collectionKinds: readonly string[];
};

const NOTHING_UNLOCKED: TemplateDeliveryPolicy = { tenantEditable: [], collectionKinds: [] };

// Tenant-created layouts have no entry of their own: they are served and edited once the app unlocks any PDF template.
export function isTenantLayout(target: DeliveryTarget): boolean {
  return target.kind === "pdf-layout" && target.slug.startsWith(TENANT_LAYOUT_SLUG_PREFIX);
}

function unlocksTenantLayouts(policy: TemplateDeliveryPolicy): boolean {
  return policy.tenantEditable.some((entry) => entry.kind === "document-pdf");
}

export function isTenantOverrideServed(
  policy: TemplateDeliveryPolicy,
  target: DeliveryTarget,
): boolean {
  return (
    policy.collectionKinds.includes(target.kind) ||
    (isTenantLayout(target) && unlocksTenantLayouts(policy)) ||
    findPolicyEntry(policy.tenantEditable, target) !== undefined
  );
}

// Served only because its kind belongs to a collection with `access`, not because the template
// is listed in tenantEditable. For these a system row of the same slug must win.
export function isServedByCollectionOnly(
  policy: TemplateDeliveryPolicy,
  target: DeliveryTarget,
): boolean {
  return (
    policy.collectionKinds.includes(target.kind) &&
    findPolicyEntry(policy.tenantEditable, target) === undefined
  );
}

export function isRowServed(
  policy: TemplateDeliveryPolicy,
  row: DeliveryTarget & { readonly tenantId: string },
): boolean {
  return row.tenantId === SYSTEM_TENANT_ID || isTenantOverrideServed(policy, row);
}

function isDeliveryTarget(value: unknown): value is DeliveryTarget {
  return (
    typeof propertyOf(value, "kind") === "string" && typeof propertyOf(value, "slug") === "string"
  );
}

function isTemplateDeliveryPolicy(value: unknown): value is TemplateDeliveryPolicy {
  if (!isPlainObject(value)) return false;
  const { tenantEditable, collectionKinds } = value;
  return (
    Array.isArray(tenantEditable) &&
    tenantEditable.every(isDeliveryTarget) &&
    Array.isArray(collectionKinds) &&
    collectionKinds.every((kind) => typeof kind === "string")
  );
}

// Fail closed: without the mounted feature (or its exports) no tenant row counts as unlocked.
export function deliveryPolicyOf(registry: Registry): TemplateDeliveryPolicy {
  const exported = propertyOf(
    propertyOf(registry.getFeature(TEMPLATE_RESOLVER_FEATURE), "exports"),
    "deliveryPolicy",
  );
  return isTemplateDeliveryPolicy(exported) ? exported : NOTHING_UNLOCKED;
}
