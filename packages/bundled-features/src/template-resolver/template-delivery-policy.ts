import type { Registry } from "@cosmicdrift/kumiko-framework/engine";
import { isPlainObject, propertyOf } from "@cosmicdrift/kumiko-types/type-guards";
import { isSystemAdmin } from "./template-draft.ts";
import { SYSTEM_TENANT_ID } from "./web/constants.ts";
import { TEMPLATE_RESOLVER_FEATURE } from "./web/qualified-names.ts";

type DeliveryTarget = { readonly kind: string; readonly slug: string };

// What decides whether a tenant row may be served. Independent of who reads: delivery must not
// change with the caller's roles, so this is not the edit policy.
export type TemplateDeliveryPolicy = {
  readonly tenantEditable: readonly DeliveryTarget[];
  /** Kinds of collections mounted with an explicit `access`; their tenant rows are edited by design. */
  readonly collectionKinds: readonly string[];
};

const NOTHING_UNLOCKED: TemplateDeliveryPolicy = { tenantEditable: [], collectionKinds: [] };

export function isTenantOverrideServed(
  policy: TemplateDeliveryPolicy,
  target: DeliveryTarget,
): boolean {
  return (
    policy.collectionKinds.includes(target.kind) ||
    policy.tenantEditable.some((entry) => entry.kind === target.kind && entry.slug === target.slug)
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
    !policy.tenantEditable.some((entry) => entry.kind === target.kind && entry.slug === target.slug)
  );
}

export function isRowServed(
  policy: TemplateDeliveryPolicy,
  row: DeliveryTarget & { readonly tenantId: string },
): boolean {
  return row.tenantId === SYSTEM_TENANT_ID || isTenantOverrideServed(policy, row);
}

// A SystemAdmin sees every stored row, so a locked override can still be reset; everyone else
// sees only what is delivered, which keeps a locked override out of the template-resolver queries for a TenantAdmin (the audit log keeps the history).
export function isRowServedTo(
  policy: TemplateDeliveryPolicy,
  user: { readonly roles: readonly string[] },
  row: DeliveryTarget & { readonly tenantId: string },
): boolean {
  return isSystemAdmin(user) || isRowServed(policy, row);
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
