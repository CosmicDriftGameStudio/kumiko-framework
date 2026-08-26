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
// Handlers: create-tag, update-tag (rename/recolor/re-scope), delete-tag
// (cascades over assignments), assign-tag, remove-tag, list tags, list assignments.
// Convention aliases tag:{create,update,delete} + tag:detail back the
// entityList/entityEdit catalog screens (legacy QNs stay for TagManager).
// Deferred: optional host-projection decoration (`wireTagsFor`), search indexing.

import {
  type AccessRule,
  defineEntityDetailHandler,
  defineEntityListHandler,
  defineFeature,
  type FeatureRegistrar,
} from "@cosmicdrift/kumiko-framework/engine";
import { DEFAULT_TAG_ACCESS, TAGS_FEATURE_NAME } from "./constants";
import { tagAssignmentEntity, tagEntity } from "./entity";
import { createAssignTagHandler } from "./handlers/assign-tag.write";
import { createCreateTagHandler } from "./handlers/create-tag.write";
import { createDeleteTagHandler } from "./handlers/delete-tag.write";
import { createRemoveTagHandler } from "./handlers/remove-tag.write";
import { createUpdateTagHandler } from "./handlers/update-tag.write";
import { TAGS_FEATURE_I18N } from "./i18n";
import { createTagEditScreen, createTagListScreen } from "./screens";

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
    "Generic, host-agnostic tagging for any entity. Owns two event-sourced entities — the per-tenant `tag` catalog (`read_tags`, with optional `color` and `scope`) and `tag-assignment` join rows keyed by (entityType, entityId) (`read_tag_assignments`) — so tagging adds NO column to the host entity and needs no relational pivot or JOIN. Provides write-handlers `create-tag`, `update-tag` (optimistic-locked rename/recolor/re-scope), `delete-tag` (cascades over assignments), `assign-tag` (idempotent), `remove-tag` (idempotent) and list queries for the catalog and the assignments. Read which tags an entity has, or which entities carry a tag, by listing `tag-assignment` filtered on `entityId` or `tagId` and composing in the read-layer. A tag with empty `scope` is global; a `scope` of an entityType restricts it to that type in the picker. Every path uses one access rule — adopt the host's model with createTagsFeature({ access: { openToAll: true } }) or pin roles with createTagsFeature({ roles }). Pass { toggleable: { default: false } } to make the whole feature tier-gatable via the tier-engine (no host hook).",
  );
  r.uiHints({
    displayLabel: "Tags",
    category: "data",
    recommended: false,
  });

  // Tier-gating is a framework concern, not a per-app hook: declaring the
  // feature toggleable lets tier-engine/feature-toggles cut it per tenant.
  if (toggleable !== undefined) r.toggleable(toggleable);

  r.entity("tag", tagEntity);
  r.entity("tag-assignment", tagAssignmentEntity);

  r.writeHandler(createCreateTagHandler(access));
  r.writeHandler(createUpdateTagHandler(access));
  r.writeHandler(createDeleteTagHandler(access));
  r.writeHandler(createAssignTagHandler(access));
  r.writeHandler(createRemoveTagHandler(access));

  // Convention aliases for entityList/entityEdit — same bodies as the legacy
  // create-tag/update-tag/delete-tag QNs (TagManager/TagPicker keep those).
  r.writeHandler(createCreateTagHandler(access, "tag:create"));
  r.writeHandler(createUpdateTagHandler(access, "tag:update"));
  r.writeHandler(createDeleteTagHandler(access, "tag:delete"));

  r.queryHandler(defineEntityListHandler("tag", tagEntity, { access }));
  r.queryHandler(defineEntityListHandler("tag-assignment", tagAssignmentEntity, { access }));
  r.queryHandler(defineEntityDetailHandler("tag", tagEntity, { access }));

  // Standalone catalog: entityList + entityEdit. App navs via
  // r.nav("tags:screen:tag-list"). TagManager stays for picker/section only.
  r.screen(createTagListScreen(access));
  r.screen(createTagEditScreen(access));
  r.translations({ keys: TAGS_FEATURE_I18N });
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
