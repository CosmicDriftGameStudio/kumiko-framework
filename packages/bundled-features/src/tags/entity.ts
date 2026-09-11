import {
  createEntity,
  createTextField,
  type EntityDefinition,
} from "@cosmicdrift/kumiko-framework/engine";

// tag — per-tenant tag catalog. Event-sourced entity (create/rename/delete via
// the standard executor); the framework projects `read_tags` from its own CRUD
// events. tenantId is a base column set by the framework → tenant-scoped.
export const tagEntity = createEntity({
  table: "read_tags",
  description:
    "One entry of a tenant's tag catalog: a name plus an optional colour hint for rendering and an optional entityType scope that limits which entities a picker offers the tag on. Names are not unique, and a tag carries no link to the entities it is attached to.",
  fields: {
    // Catalog labels ("urgent", "billing"), not user-identifying content —
    // `personal: false` silences the user-content heuristic (456/5). A tag
    // has no author to anchor a `personal: { of: "<f>" }` annotation to, and
    // a tag isn't ABOUT the entity that created it anyway — it's a catalog
    // entry shared across whatever gets assigned it. If a tenant ever names a
    // tag after a real person, the fix is renaming or deleting that tag, not
    // wiring it to a subject key.
    name: createTextField({
      required: true,
      maxLength: 64,
      sortable: true,
      searchable: true,
      personal: false,
      reason: "catalog_label",
    }),
    // Optional UI hint (hex or token). No enforcement — purely for rendering.
    color: createTextField({ maxLength: 32, personal: false, reason: "technical_reference" }),
    // Optional entity-type scope (GitLab project-vs-group labels): empty = global
    // (offered on every entity); a value like "note" restricts the tag to that
    // entityType in the picker. No enforcement on assign — purely a picker hint.
    scope: createTextField({ maxLength: 64, personal: false, reason: "technical_reference" }),
  },
});

// tag-assignment — host-agnostic join row keyed by (entityType, entityId). This
// is the event-sourced, feature-owned projection that replaces a relational
// pivot+JOIN: the framework projects `read_tag_assignments` from this entity's
// own CRUD events, so tagging needs NO column on the host entity.
//
// The assignment's aggregate-id is derived deterministically from
// (tenantId, tagId, entityType, entityId) — see aggregate-id.ts — so there is
// exactly one row per (tag, entity) and assign is idempotent.
//
// softDelete is required, NOT cosmetic: the aggregate-id is deterministic, so
// removing a tag leaves a (created+deleted) event stream behind under that id.
// A hard delete would force the next assign to create() at version 0 onto that
// existing stream → version_conflict (the same tag could never be re-attached).
// With softDelete the assign handler resurrects the stream via restore(); the
// list query filters isDeleted, so removed assignments stay hidden.
//
// Cross-entity views compose in the read-layer (no JOIN):
//   - tags of an entity   → list assignments filter { field: "entityId", op: "eq" }
//   - entities with a tag  → list assignments filter { field: "tagId",   op: "eq" }
export function createTagAssignmentEntity(access?: EntityDefinition["access"]) {
  return createEntity({
    table: "read_tag_assignments",
    description:
      "The join row recording that one catalog tag is attached to one host entity, addressed by tagId, entityType and entityId, with exactly one row per pair. An entity may carry many tags, unlike the single-folder membership rows.",
    softDelete: true,
    access,
    fields: {
      tagId: createTextField({
        required: true,
        maxLength: 64,
        personal: false,
        reason: "technical_reference",
      }),
      entityType: createTextField({
        required: true,
        maxLength: 64,
        personal: false,
        reason: "technical_reference",
      }),
      // Host entity ids are uuid/text; 128 covers uuid plus non-uuid text keys.
      entityId: createTextField({
        required: true,
        maxLength: 128,
        personal: false,
        reason: "technical_reference",
      }),
    },
  });
}

export const tagAssignmentEntity = createTagAssignmentEntity();
