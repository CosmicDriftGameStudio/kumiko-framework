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
// Handlers: tag:create, tag:update (rename/recolor/re-scope), tag:delete
// (cascades over assignments), assign-tag, remove-tag, list tags, list assignments,
// tag:detail. They back the entityList/entityEdit catalog screens and TagManager.
// Deferred: optional host-projection decoration (`wireTagsFor`), search indexing.

import {
  type AccessRule,
  bootRuleError,
  defineEntityDetailHandler,
  defineEntityListHandler,
  defineEntityUpdateHandler,
  defineFeature,
  type EntityDefinition,
  type FeatureDefinition,
  type FeatureRegistrar,
} from "@cosmicdrift/kumiko-framework/engine";
import { assertNoWhereRuleInOwnershipWrite, resolveFeatureAccess } from "../shared/index.ts";
import { TAGS_BOOT_RULES } from "./boot-rules.ts";
import { createTagAssignmentEntity, tagEntity } from "./entity.ts";
import { createTagAssignmentExecutor } from "./executor.ts";
import { createAssignTagHandler } from "./handlers/assign-tag.write.ts";
import { createCreateTagHandler } from "./handlers/create-tag.write.ts";
import { createDeleteTagHandler } from "./handlers/delete-tag.write.ts";
import { createRemoveTagHandler } from "./handlers/remove-tag.write.ts";
import { TAGS_FEATURE_I18N } from "./i18n.ts";
import { rejectInvalidTagColorChange } from "./schemas.ts";
import { createTagEditScreen, createTagListScreen } from "./screens.ts";
import { DEFAULT_TAG_ACCESS, TAGS_FEATURE_NAME } from "./web/constants.ts";

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
  parents: readonly string[],
): void {
  r.describe(
    "Generic, host-agnostic tagging for any entity. Owns two event-sourced entities — the per-tenant `tag` catalog (`read_tags`, with optional `color` and `scope`) and `tag-assignment` join rows keyed by (entityType, entityId) (`read_tag_assignments`) — so tagging adds NO column to the host entity and needs no relational pivot or JOIN. The catalog is written through `tag:create`, `tag:update` (`{ id, version, changes }`) and `tag:delete` (cascades over the assignments and refuses while a record the caller cannot see still carries the tag), used by the declarative catalog screens and by TagManager/TagPicker alike. Also: `assign-tag` (idempotent), `remove-tag` (idempotent) and list queries for the catalog and the assignments. Read which tags an entity has, or which entities carry a tag, by listing `tag-assignment` filtered on `entityId` or `tagId` and composing in the read-layer. A tag with empty `scope` is global; a `scope` of an entityType restricts it to that type in the picker. Every path uses one access rule — adopt the host's model with createTagsFeature({ access: { openToAll: { reason } } }) or pin roles with createTagsFeature({ roles }). Mount with createTagsFeature({ parents: [<host entities>] }). Pass { toggleable: { default: false } } to make the whole feature tier-gatable via the tier-engine (no host hook).",
  );
  r.uiHints({
    displayLabel: "Tags",
    category: "data",
    recommended: false,
  });

  // Tier-gating is a framework concern, not a per-app hook: declaring the
  // feature toggleable lets tier-engine/feature-toggles cut it per tenant.
  if (toggleable !== undefined) r.toggleable(toggleable);

  const tagAssignmentEntity = createTagAssignmentEntity(ownership, parents);
  r.entity({ name: "tag", ...tagEntity });
  r.entity({ name: "tag-assignment", ...tagAssignmentEntity });

  r.writeHandler(createCreateTagHandler(access));
  const tagUpdate = r.writeHandler(
    defineEntityUpdateHandler("tag", tagEntity, {
      access,
      description:
        "Renames, recolours or re-scopes a catalog tag from the `{ id, version, changes }` envelope with optimistic locking; omitted fields stay untouched and color or scope accept an empty string to clear them.",
    }),
  );
  r.hook({ type: "validation", target: tagUpdate, handler: rejectInvalidTagColorChange });
  const assignmentExecutor = createTagAssignmentExecutor(ownership, parents);
  r.writeHandler(createDeleteTagHandler(access, assignmentExecutor));
  r.writeHandler(createAssignTagHandler(access, assignmentExecutor));
  r.writeHandler(createRemoveTagHandler(access, assignmentExecutor));

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
  // r.nav("tags:screen:tag-list"). TagManager serves picker/section only.
  r.screen(createTagListScreen(access));
  r.screen(createTagEditScreen(access));
  r.translations({ keys: TAGS_FEATURE_I18N });
}

export type TagsFeatureOptions = {
  /** Access rule for all tag write/read paths. Default { roles: ["TenantAdmin","TenantMember"] }.
   *  Adopt the host's model — e.g. { openToAll: { reason: "..." } } when the host lets any
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
   *  at all. `ownership.read` is no longer what keeps a caller from reading
   *  assignments on host entities they can't see: that gate is default-on and
   *  derives from the entity's `parentRef`. Use `ownership.read` for an
   *  ADDITIONAL row rule on the assignment row itself; it is AND-ed with the
   *  host-visibility gate, never a replacement for it. Applies only to
   *  `tag-assignment`; the `tag` catalog stays tenant-wide by design.
   *
   *  `ownership.write` is separate and does NOT affect list/read. It's
   *  consulted on every assignment write: assign-tag (create/restore),
   *  remove-tag (delete) and the framework's generic forget path. The
   *  delete-tag cascade detaches without the write rule, but tag:delete
   *  refuses while an assignment the caller cannot read still points at a
   *  live record. A `from()` rule there also gates GDPR erasure (`forget`): if the rule's role map doesn't cover whatever role the
   *  erasure/retention pipeline runs as, `forget` denies instead of
   *  crypto-shredding — a silent Art.17 failure, not a thrown error. Make
   *  sure any `ownership.write` you set covers that role, or leave it unset. */
  readonly ownership?: EntityDefinition["access"];
  /** Registered entities a row may hang off (entityType). Required and non-empty: the read gate
   *  builds one SQL branch per host. Every path still checks that the host row is visible to the
   *  caller through the host's own read path. */
  readonly parents: readonly string[];
};

export function createTagsFeature(opts: TagsFeatureOptions): FeatureDefinition {
  if (opts.parents.length === 0) {
    throw bootRuleError(TAGS_BOOT_RULES.emptyParentsAllowlist, {
      message:
        "createTagsFeature({ parents }): parents must not be an empty array — " +
        "an empty allowlist rejects every assignment. List at least one host entity.",
    });
  }
  assertNoWhereRuleInOwnershipWrite("createTagsFeature", opts.ownership?.write);
  const access = resolveFeatureAccess(opts, DEFAULT_TAG_ACCESS);
  return defineFeature(TAGS_FEATURE_NAME, (r) =>
    registerTags(r, access, opts.toggleable, opts.ownership, opts.parents),
  );
}
