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
  defineEntityUpdateHandler,
  defineFeature,
  type EntityDefinition,
  type FeatureRegistrar,
} from "@cosmicdrift/kumiko-framework/engine";
import { hasWhereRule } from "../shared";
import { DEFAULT_TAG_ACCESS, TAGS_FEATURE_NAME } from "./constants";
import { createTagAssignmentEntity, tagEntity } from "./entity";
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
  ownership: EntityDefinition["access"] | undefined,
): void {
  r.describe(
    "Generic, host-agnostic tagging for any entity. Owns two event-sourced entities — the per-tenant `tag` catalog (`read_tags`, with optional `color` and `scope`) and `tag-assignment` join rows keyed by (entityType, entityId) (`read_tag_assignments`) — so tagging adds NO column to the host entity and needs no relational pivot or JOIN. Catalog screens are declarative (`entityList` + `entityEdit`) and use convention QNs `tag:{create,update,delete}`; TagManager/TagPicker keep `create-tag`/`update-tag`/`delete-tag`. Also: `assign-tag` (idempotent), `remove-tag` (idempotent) and list queries for the catalog and the assignments. Read which tags an entity has, or which entities carry a tag, by listing `tag-assignment` filtered on `entityId` or `tagId` and composing in the read-layer. A tag with empty `scope` is global; a `scope` of an entityType restricts it to that type in the picker. Every path uses one access rule — adopt the host's model with createTagsFeature({ access: { openToAll: true } }) or pin roles with createTagsFeature({ roles }). Pass { toggleable: { default: false } } to make the whole feature tier-gatable via the tier-engine (no host hook).",
  );
  r.uiHints({
    displayLabel: "Tags",
    category: "data",
    recommended: false,
  });

  // Tier-gating is a framework concern, not a per-app hook: declaring the
  // feature toggleable lets tier-engine/feature-toggles cut it per tenant.
  if (toggleable !== undefined) r.toggleable(toggleable);

  const tagAssignmentEntity = createTagAssignmentEntity(ownership);
  r.entity("tag", tagEntity);
  r.entity("tag-assignment", tagAssignmentEntity);

  r.writeHandler(createCreateTagHandler(access));
  r.writeHandler(createUpdateTagHandler(access));
  r.writeHandler(createDeleteTagHandler(access));
  r.writeHandler(createAssignTagHandler(access));
  r.writeHandler(createRemoveTagHandler(access));

  // Convention aliases for entityList/entityEdit — create stays flat-payload
  // (payloadMode=values); update must accept the {id,version,changes} envelope
  // entityEdit sends (legacy update-tag stays for TagManager). delete stays
  // legacy so assignment cascade is preserved (convention delete would orphan).
  r.writeHandler({
    ...createCreateTagHandler(access, "tag:create"),
    description:
      "Adds a tag to the caller's tenant tag catalog and mints its id; this is the convention name the declarative tag catalog screens dispatch, with the same effect as the legacy create-tag.",
  });
  r.writeHandler(
    defineEntityUpdateHandler("tag", tagEntity, {
      access,
      description:
        "Renames, recolours or re-scopes a catalog tag from the entity-edit `{ id, version, changes }` envelope; this is the convention name the tag edit screen submits, unlike the flat-payload legacy update-tag.",
    }),
  );
  r.writeHandler({
    ...createDeleteTagHandler(access, "tag:delete"),
    description:
      "Deletes a catalog tag and detaches it from every entity carrying it; this is the convention name the tag catalog list screen's delete row-action dispatches, with the same cascade as the legacy delete-tag.",
    agent: { risk: "high" },
  });

  r.queryHandler(
    defineEntityListHandler("tag", tagEntity, {
      access,
      description:
        "Lists the caller's tenant tag catalog with each tag's name, colour and scope; use it to render the catalog or to offer a user the tags they can attach.",
    }),
  );
  r.queryHandler(
    defineEntityListHandler("tag-assignment", tagAssignmentEntity, {
      access,
      description:
        "Lists the tag-to-entity assignment rows of the caller's tenant; filter on entityId to get one record's tags, or on tagId to get every record carrying a tag.",
    }),
  );
  r.queryHandler(
    defineEntityDetailHandler("tag", tagEntity, {
      access,
      description:
        "Reads one catalog tag by id with its name, colour and scope; use it to load a single tag into an edit form rather than to find which entities carry it.",
    }),
  );

  // Standalone catalog: entityList + entityEdit. App navs via
  // r.nav("tags:screen:tag-list"). TagManager stays for picker/section only.
  r.screen(createTagListScreen(access));
  r.screen(createTagEditScreen(access));
  r.translations({ keys: TAGS_FEATURE_I18N });
}

export const tagsFeature = defineFeature(TAGS_FEATURE_NAME, (r) =>
  registerTags(r, DEFAULT_TAG_ACCESS, undefined, undefined),
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
  /** Row-level ownership on the tag-assignment rows themselves — orthogonal to
   *  `access`, which only gates whether a caller may dispatch assign/remove/list
   *  at all. Set `ownership.read` to close the read leak: without it — even if
   *  `ownership.write` is set — `access.read` stays undefined and any
   *  dispatch-eligible user can read every assignment in the tenant, including
   *  assignments on entities they can't otherwise see. Applies only to
   *  `tag-assignment`; the `tag` catalog stays tenant-wide by design.
   *
   *  `ownership.write` is separate and does NOT affect list/read. It's
   *  consulted by the framework's generic delete/forget/restore paths (not by
   *  this feature's own assign-tag handler — see createTagsFeature's
   *  boot-guard comment). A `from()` rule there also gates GDPR erasure
   *  (`forget`): if the rule's role map doesn't cover whatever role the
   *  erasure/retention pipeline runs as, `forget` denies instead of
   *  crypto-shredding — a silent Art.17 failure, not a thrown error. Make
   *  sure any `ownership.write` you set covers that role, or leave it unset. */
  readonly ownership?: EntityDefinition["access"];
};

function resolveAccess(opts: TagsFeatureOptions): AccessRule {
  if (opts.access !== undefined) return opts.access;
  if (opts.roles !== undefined) return { roles: opts.roles };
  return DEFAULT_TAG_ACCESS;
}

// Backwards-compat / options wrapper. Without options returns the module-level
// singleton (no rebuild). access/roles/toggleable/ownership build a fresh
// feature-definition.
export function createTagsFeature(opts: TagsFeatureOptions = {}): typeof tagsFeature {
  if (
    opts.access === undefined &&
    opts.roles === undefined &&
    opts.toggleable === undefined &&
    opts.ownership === undefined
  ) {
    return tagsFeature;
  }
  if (hasWhereRule(opts.ownership?.write)) {
    throw new Error(
      "createTagsFeature({ ownership }): ownership.write must not contain a " +
        '`{ kind: "where" }` rule — where-rules are evaluated only at the SQL ' +
        "layer (the read path, via buildOwnershipClause). Write paths that " +
        "consult access.write (userCanCreateFieldRow/userCanWriteFieldRow) can't " +
        "evaluate them, so such a rule can only ever deny — boot validation " +
        "rejects it too (fw#2626). Use a `from()` rule for ownership.write, or " +
        "leave it unset.",
    );
  }
  const access = resolveAccess(opts);
  return defineFeature(TAGS_FEATURE_NAME, (r) =>
    registerTags(r, access, opts.toggleable, opts.ownership),
  );
}
