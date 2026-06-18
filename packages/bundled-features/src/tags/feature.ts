// tags — generic, host-agnostic tagging for ANY entity.
//
// **Event-sourced, not relational.** There is no pivot table with foreign keys
// and JOINs. The feature owns two event-sourced entities:
//   1. `tag` (read_tags)            — per-tenant tag catalog.
//   2. `tag-assignment` (read_tag_assignments) — join rows keyed by
//      (entityType, entityId), with a deterministic aggregate-id so assign is
//      idempotent. The framework projects both tables from their own CRUD
//      events; no host column and no hand-written MSP are needed.
//
// Cross-entity views compose in the read-layer (no JOIN) by listing
// tag-assignments filtered on entityId (tags of an entity) or tagId (entities
// with a tag). See entity.ts.
//
// v1 scope: create-tag, assign-tag, remove-tag, list tags, list assignments.
// Deferred: rename/delete-tag, optional host-projection decoration
// (`wireTagsFor`), search indexing, user-data-rights anonymization.

import {
  defineEntityListHandler,
  defineFeature,
  type FeatureRegistrar,
} from "@cosmicdrift/kumiko-framework/engine";
import { DEFAULT_TAG_ROLES, TAGS_FEATURE_NAME } from "./constants";
import { tagAssignmentEntity, tagEntity } from "./entity";
import { createAssignTagHandler } from "./handlers/assign-tag.write";
import { createCreateTagHandler } from "./handlers/create-tag.write";
import { createRemoveTagHandler } from "./handlers/remove-tag.write";

function registerTags(
  r: FeatureRegistrar<typeof TAGS_FEATURE_NAME>,
  roles: readonly string[],
): void {
  r.describe(
    "Generic, host-agnostic tagging for any entity. Owns two event-sourced entities — the per-tenant `tag` catalog (`read_tags`) and `tag-assignment` join rows keyed by (entityType, entityId) (`read_tag_assignments`) — so tagging adds NO column to the host entity and needs no relational pivot or JOIN. Provides write-handlers `create-tag`, `assign-tag` (idempotent), `remove-tag` (idempotent) and list queries for the catalog and the assignments. Read which tags an entity has, or which entities carry a tag, by listing `tag-assignment` filtered on `entityId` or `tagId` and composing in the read-layer. Override the default tenant roles with createTagsFeature({ roles }).",
  );

  r.entity("tag", tagEntity);
  r.entity("tag-assignment", tagAssignmentEntity);

  r.writeHandler(createCreateTagHandler(roles));
  r.writeHandler(createAssignTagHandler(roles));
  r.writeHandler(createRemoveTagHandler(roles));

  r.queryHandler(defineEntityListHandler("tag", tagEntity, { access: { roles } }));
  r.queryHandler(
    defineEntityListHandler("tag-assignment", tagAssignmentEntity, { access: { roles } }),
  );
}

export const tagsFeature = defineFeature(TAGS_FEATURE_NAME, (r) =>
  registerTags(r, DEFAULT_TAG_ROLES),
);

export type TagsFeatureOptions = {
  /** RBAC roles for all tag write/read paths. Default ["TenantAdmin","TenantMember"].
   *  Apps with their own role vocabulary (e.g. ["Admin","Editor"]) MUST set this,
   *  else the hard-wired tag QNs are access_denied for their users. */
  readonly roles?: readonly string[];
};

// Backwards-compat / options wrapper. Without options returns the module-level
// singleton (no rebuild). A custom roles list builds a fresh feature-definition.
export function createTagsFeature(opts: TagsFeatureOptions = {}): typeof tagsFeature {
  if (opts.roles === undefined) {
    return tagsFeature;
  }
  const roles = opts.roles;
  return defineFeature(TAGS_FEATURE_NAME, (r) => registerTags(r, roles));
}
