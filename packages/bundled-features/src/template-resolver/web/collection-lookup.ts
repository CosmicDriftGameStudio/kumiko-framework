import { isUiAccessGranted } from "@cosmicdrift/kumiko-framework/ui-types";
import type { FeatureSchema } from "@cosmicdrift/kumiko-renderer";
import { DEFAULT_COLLECTION_ACCESS } from "./constants.ts";

export type ContentCollectionSchema = NonNullable<FeatureSchema["contentCollections"]>[number];

// A node without a collectionId (the hand-wired text-block tree) has no
// collection to look up — contentFormat/variableSchema then fall back to
// their own callers' defaults.
export function findCollection(
  features: readonly FeatureSchema[],
  collectionId?: string,
): ContentCollectionSchema | undefined {
  if (collectionId === undefined) return undefined;
  for (const feature of features) {
    const match = feature.contentCollections?.find((c) => c.id === collectionId);
    if (match !== undefined) return match;
  }
  return undefined;
}

// Who may save follows the server: a collection's set handler carries the
// collection's own access rule (one rule for list, item and set), the public
// text-block pair stays TenantAdmin/SystemAdmin. Other users see the form read-only.
export function canWriteContent(
  collection: Pick<ContentCollectionSchema, "access"> | undefined,
  roles: readonly string[] | undefined,
): boolean {
  if (collection !== undefined) {
    return isUiAccessGranted(collection.access ?? DEFAULT_COLLECTION_ACCESS, roles);
  }
  return roles?.includes("TenantAdmin") === true || roles?.includes("SystemAdmin") === true;
}
