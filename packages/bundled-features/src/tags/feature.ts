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
  type AccessRule,
  defineEntityListHandler,
  defineFeature,
  type FeatureRegistrar,
} from "@cosmicdrift/kumiko-framework/engine";
import { DEFAULT_TAG_ACCESS, TAGS_FEATURE_NAME } from "./constants";
import { tagAssignmentEntity, tagEntity } from "./entity";
import { createAssignTagHandler } from "./handlers/assign-tag.write";
import { createCreateTagHandler } from "./handlers/create-tag.write";
import { createRemoveTagHandler } from "./handlers/remove-tag.write";

// Opt-in tier-gating: when set, the feature declares itself r.toggleable so the
// dispatcher gate + feature-toggles + tier-engine can switch the WHOLE feature
// (handlers, queries, hooks) on/off per tenant — no host-side hook. `default`
// is the enablement when no toggle row / tier override exists. For a tier-gated
// feature use { default: false } (fail-closed) and list the feature name in the
// entitling tiers' TierMap; tenants below it get every tag path disabled.
type TagsToggleable = { readonly default: boolean };

function registerTags(
  r: FeatureRegistrar<typeof TAGS_FEATURE_NAME>,
  access: AccessRule,
  toggleable: TagsToggleable | undefined,
): void {
  r.describe(
    "Generic, host-agnostic tagging for any entity. Owns two event-sourced entities — the per-tenant `tag` catalog (`read_tags`) and `tag-assignment` join rows keyed by (entityType, entityId) (`read_tag_assignments`) — so tagging adds NO column to the host entity and needs no relational pivot or JOIN. Provides write-handlers `create-tag`, `assign-tag` (idempotent), `remove-tag` (idempotent) and list queries for the catalog and the assignments. Read which tags an entity has, or which entities carry a tag, by listing `tag-assignment` filtered on `entityId` or `tagId` and composing in the read-layer. Every path uses one access rule — adopt the host's model with createTagsFeature({ access: { openToAll: true } }) or pin roles with createTagsFeature({ roles }). Pass { toggleable: { default: false } } to make the whole feature tier-gatable via the tier-engine (no host hook).",
  );

  // Tier-gating is a framework concern, not a per-app hook: declaring the
  // feature toggleable lets tier-engine/feature-toggles cut it per tenant.
  if (toggleable !== undefined) r.toggleable(toggleable);

  r.entity("tag", tagEntity);
  r.entity("tag-assignment", tagAssignmentEntity);

  r.writeHandler(createCreateTagHandler(access));
  r.writeHandler(createAssignTagHandler(access));
  r.writeHandler(createRemoveTagHandler(access));

  r.queryHandler(defineEntityListHandler("tag", tagEntity, { access }));
  r.queryHandler(defineEntityListHandler("tag-assignment", tagAssignmentEntity, { access }));
}

export const tagsFeature = defineFeature(TAGS_FEATURE_NAME, (r) =>
  registerTags(r, DEFAULT_TAG_ACCESS, undefined),
);

export type TagsFeatureOptions = {
  /** Access rule for all tag write/read paths. Default { roles: ["TenantAdmin","TenantMember"] }.
   *  Adopt the host's model — e.g. { openToAll: true } when the host lets any
   *  authenticated tenant user tag (like the rest of its handlers), or
   *  { roles: ["Admin"] } for a custom role vocabulary. Takes precedence over `roles`. */
  readonly access?: AccessRule;
  /** Shorthand for { access: { roles } }. Ignored when `access` is set. */
  readonly roles?: readonly string[];
  /** Make the whole feature tier-gatable: declares r.toggleable so the
   *  tier-engine/feature-toggles can enable/disable every tag path per tenant.
   *  `default` applies when no toggle/tier override exists — use { default: false }
   *  for fail-closed tier-gating. Omit to keep tags always-on (default). */
  readonly toggleable?: TagsToggleable;
};

function resolveAccess(opts: TagsFeatureOptions): AccessRule {
  if (opts.access !== undefined) return opts.access;
  if (opts.roles !== undefined) return { roles: opts.roles };
  return DEFAULT_TAG_ACCESS;
}

// Backwards-compat / options wrapper. Without options returns the module-level
// singleton (no rebuild). access/roles/toggleable build a fresh feature-definition.
export function createTagsFeature(opts: TagsFeatureOptions = {}): typeof tagsFeature {
  if (opts.access === undefined && opts.roles === undefined && opts.toggleable === undefined) {
    return tagsFeature;
  }
  const access = resolveAccess(opts);
  return defineFeature(TAGS_FEATURE_NAME, (r) => registerTags(r, access, opts.toggleable));
}
