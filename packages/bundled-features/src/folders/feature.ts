// folders — generic, host-agnostic hierarchical folders for ANY entity.
//
// **Event-sourced, not relational.** No pivot table with foreign keys and JOINs.
// The feature owns two event-sourced entities:
//   1. `folder` (read_folders)                   — per-tenant folder tree (parentId).
//   2. `folder-assignment` (read_folder_assignments) — single-membership rows keyed
//      by (entityType, entityId) with a deterministic aggregate-id, so an entity
//      belongs to at most one folder and re-setting moves it.
//
// Cross-entity views compose in the read-layer (no JOIN): list folder-assignments
// filtered on entityId (the folder of an entity) or folderId (entities in a folder).
//
// Scope: folder catalog CRUD (create/update[=rename]/delete/list/detail via the
// generic entity handlers), set-folder (put/move), clear-folder (unfile).
// Deferred: reparenting with cycle-check (folder:update CAN change parentId, but
// no UI exposes it in v1 — folders-view guards cycles defensively).

import {
  type AccessRule,
  defineEntityCreateHandler,
  defineEntityDetailHandler,
  defineEntityListHandler,
  defineEntityUpdateHandler,
  defineFeature,
  type FeatureRegistrar,
} from "@cosmicdrift/kumiko-framework/engine";
import { DEFAULT_FOLDER_ACCESS, FOLDERS_FEATURE_NAME } from "./constants";
import { folderAssignmentEntity, folderEntity } from "./entity";
import { createClearFolderHandler } from "./handlers/clear-folder.write";
import { createDeleteFolderHandler } from "./handlers/delete-folder.write";
import { createSetFolderHandler } from "./handlers/set-folder.write";

// Opt-in tier-gating: when set, the feature declares itself r.toggleable so the
// dispatcher gate + feature-toggles + tier-engine can switch the WHOLE feature
// on/off per tenant — no host-side hook. For a tier-gated feature use
// { default: false } (fail-closed) and list the feature name in the entitling
// tiers' TierMap; tenants below it get every folder path disabled.
type FoldersToggleable = { readonly default: boolean };

function registerFolders(
  r: FeatureRegistrar<typeof FOLDERS_FEATURE_NAME>,
  access: AccessRule,
  toggleable: FoldersToggleable | undefined,
): void {
  r.describe(
    "Generic, host-agnostic hierarchical folders for any entity. Owns two event-sourced entities — the per-tenant `folder` tree (`read_folders`, self-referential via parentId) and SINGLE-membership `folder-assignment` rows keyed by (entityType, entityId) (`read_folder_assignments`) — so filing an entity adds NO column to the host and needs no relational pivot or JOIN. The folder catalog uses the generic entity handlers (create, update [= rename, optimistic-locked], delete, list, detail); set-folder puts/moves an entity into a folder (one folder per entity) and clear-folder unfiles it (both idempotent). Read which folder an entity is in, or which entities a folder holds, by listing `folder-assignment` filtered on `entityId` or `folderId`. Every path uses one access rule — adopt the host's model with createFoldersFeature({ access: { openToAll: true } }) or pin roles. Pass { toggleable: { default: false } } to make the whole feature tier-gatable via the tier-engine (no host hook).",
  );
  r.uiHints({
    displayLabel: "Folders",
    category: "data",
    recommended: false,
  });

  if (toggleable !== undefined) r.toggleable(toggleable);

  r.entity("folder", folderEntity);
  r.entity("folder-assignment", folderAssignmentEntity);

  // Folder catalog — plain CRUD, no custom logic. update is rename (and, in a
  // later stage, reparent: it accepts changes.parentId, optimistic-locked).
  r.writeHandler(defineEntityCreateHandler("folder", folderEntity, { access }));
  r.writeHandler(defineEntityUpdateHandler("folder", folderEntity, { access }));
  // Custom, not defineEntityDeleteHandler: blocks the delete when folder-
  // assignments still point at this folder (658/1) — see delete-folder.write.ts.
  r.writeHandler(createDeleteFolderHandler(access));
  r.queryHandler(defineEntityListHandler("folder", folderEntity, { access }));
  r.queryHandler(defineEntityDetailHandler("folder", folderEntity, { access }));

  // Single-membership assignment — hand-written (deterministic id + move/restore).
  r.writeHandler(createSetFolderHandler(access));
  r.writeHandler(createClearFolderHandler(access));
  r.queryHandler(defineEntityListHandler("folder-assignment", folderAssignmentEntity, { access }));
}

export const foldersFeature = defineFeature(FOLDERS_FEATURE_NAME, (r) =>
  registerFolders(r, DEFAULT_FOLDER_ACCESS, undefined),
);

export type FoldersFeatureOptions = {
  /** Access rule for all folder write/read paths. Default { roles: ["TenantAdmin","TenantMember"] }.
   *  Adopt the host's model — e.g. { openToAll: true } when any authenticated
   *  tenant user may file entities, or { roles: ["Admin"] } for a custom role
   *  vocabulary. Takes precedence over `roles`. */
  readonly access?: AccessRule;
  /** Shorthand for { access: { roles } }. Ignored when `access` is set. */
  readonly roles?: readonly string[];
  /** Make the whole feature tier-gatable: declares r.toggleable so the
   *  tier-engine/feature-toggles can enable/disable every folder path per tenant.
   *  `default` applies when no toggle/tier override exists — use { default: false }
   *  for fail-closed tier-gating. Omit to keep folders always-on (default). */
  readonly toggleable?: FoldersToggleable;
};

function resolveAccess(opts: FoldersFeatureOptions): AccessRule {
  if (opts.access !== undefined) return opts.access;
  if (opts.roles !== undefined) return { roles: opts.roles };
  return DEFAULT_FOLDER_ACCESS;
}

// Options wrapper. Without options returns the module-level singleton (no
// rebuild). access/roles/toggleable build a fresh feature-definition.
export function createFoldersFeature(opts: FoldersFeatureOptions = {}): typeof foldersFeature {
  if (opts.access === undefined && opts.roles === undefined && opts.toggleable === undefined) {
    return foldersFeature;
  }
  const access = resolveAccess(opts);
  return defineFeature(FOLDERS_FEATURE_NAME, (r) => registerFolders(r, access, opts.toggleable));
}
