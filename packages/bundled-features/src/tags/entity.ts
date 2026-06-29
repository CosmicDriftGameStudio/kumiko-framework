import { createEntity, createTextField } from "@cosmicdrift/kumiko-framework/engine";

// tag — per-tenant tag catalog. Event-sourced entity (create/rename/delete via
// the standard executor); the framework projects `read_tags` from its own CRUD
// events. tenantId is a base column set by the framework → tenant-scoped.
export const tagEntity = createEntity({
  table: "read_tags",
  fields: {
    name: createTextField({ required: true, maxLength: 64 }),
    // Optional UI hint (hex or token). No enforcement — purely for rendering.
    color: createTextField({ maxLength: 32 }),
    // Optional entity-type scope (GitLab project-vs-group labels): empty = global
    // (offered on every entity); a value like "note" restricts the tag to that
    // entityType in the picker. No enforcement on assign — purely a picker hint.
    scope: createTextField({ maxLength: 64 }),
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
export const tagAssignmentEntity = createEntity({
  table: "read_tag_assignments",
  softDelete: true,
  fields: {
    tagId: createTextField({ required: true, maxLength: 64 }),
    entityType: createTextField({ required: true, maxLength: 64 }),
    // Host entity ids are uuid/text; 128 covers uuid plus non-uuid text keys.
    entityId: createTextField({ required: true, maxLength: 128 }),
  },
});
