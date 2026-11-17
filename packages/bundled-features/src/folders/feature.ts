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
// folder:update can reparent; folder-parent-guard.ts rejects unknown parents and cycles,
// and folder:delete refuses a folder that still has child folders or live assignments.

import {
  type AccessRule,
  bootRuleError,
  defineEntityCreateHandler,
  defineEntityDetailHandler,
  defineEntityListHandler,
  defineEntityUpdateHandler,
  defineFeature,
  type EntityDefinition,
  EXT_USER_DATA,
  type FeatureDefinition,
  type FeatureRegistrar,
} from "@cosmicdrift/kumiko-framework/engine";
import { assertNoWhereRuleInOwnershipWrite, resolveFeatureAccess } from "../shared/index.ts";
import { FOLDERS_BOOT_RULES } from "./boot-rules.ts";
import { createFolderAssignmentEntity, folderEntity } from "./entity.ts";
import { createFolderAssignmentExecutor } from "./executor.ts";
import { rejectInvalidFolderParent } from "./folder-parent-guard.ts";
import { createClearFolderHandler } from "./handlers/clear-folder.write.ts";
import { createDeleteFolderHandler } from "./handlers/delete-folder.write.ts";
import { createSetFolderHandler } from "./handlers/set-folder.write.ts";
import {
  folderAssignmentDeleteHook,
  folderAssignmentExportHook,
  folderDeleteHook,
  folderExportHook,
} from "./user-data-hooks.ts";
import { DEFAULT_FOLDER_ACCESS, FOLDERS_FEATURE_NAME } from "./web/constants.ts";

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
  ownership: EntityDefinition["access"] | undefined,
  parents: readonly string[],
): void {
  r.describe(
    "Generic, host-agnostic hierarchical folders for any entity. Owns two event-sourced entities — the per-tenant `folder` tree (`read_folders`, self-referential via parentId) and SINGLE-membership `folder-assignment` rows keyed by (entityType, entityId) (`read_folder_assignments`) — so filing an entity adds NO column to the host and needs no relational pivot or JOIN. The folder catalog uses the generic entity handlers (create, update [= rename, optimistic-locked], delete, list, detail); set-folder puts/moves an entity into a folder (one folder per entity) and clear-folder unfiles it (both idempotent). Read which folder an entity is in, or which entities a folder holds, by listing `folder-assignment` filtered on `entityId` or `folderId`. Every path uses one access rule — adopt the host's model with createFoldersFeature({ access: { openToAll: { reason } } }) or pin roles. Mount with createFoldersFeature({ parents: [<host entities>] }). Pass { toggleable: { default: false } } to make the whole feature tier-gatable via the tier-engine (no host hook).",
  );
  r.uiHints({
    displayLabel: "Folders",
    category: "data",
    recommended: false,
  });

  if (toggleable !== undefined) r.toggleable(toggleable);

  const folderAssignmentEntity = createFolderAssignmentEntity(ownership, parents);
  r.entity(folderEntity);
  r.entity(folderAssignmentEntity);
  r.applyExtension({ name: EXT_USER_DATA, entity: "folder", export: folderExportHook, delete: folderDeleteHook });
  r.applyExtension({ name: EXT_USER_DATA, entity: "folder-assignment", export: folderAssignmentExportHook,
    delete: folderAssignmentDeleteHook });
  const assignmentExecutor = createFolderAssignmentExecutor(ownership, parents);

  // Folder catalog — generic CRUD. update renames or reparents (optimistic-locked); the
  // preSave guard below checks the parent.
  r.writeHandler(
    defineEntityCreateHandler("folder", folderEntity, {
      access,
      description:
        "Creates a folder in the caller's tenant folder tree, optionally nested under a parent folder; use it to grow the folder catalog, not to file an entity into a folder.",
    }),
  );
  r.writeHandler(
    defineEntityUpdateHandler("folder", folderEntity, {
      access,
      description:
        "Renames a folder or moves it under a different parent folder; use it to reorganise the catalog itself, which leaves the entities filed in that folder where they are.",
    }),
  );
  r.hook({ type: "preSave", target: "folder:create", handler: rejectInvalidFolderParent });
  r.hook({ type: "preSave", target: "folder:update", handler: rejectInvalidFolderParent });
  // Custom, not defineEntityDeleteHandler: blocks the delete when folder-
  // assignments still point at this folder (658/1) — see delete-folder.write.ts.
  r.writeHandler(createDeleteFolderHandler(access, assignmentExecutor));
  r.queryHandler(
    defineEntityListHandler("folder", folderEntity, {
      access,
      description:
        "Lists the caller's tenant folders with their names and parent ids so the whole folder tree can be reassembled; use it to render a folder tree or to let a user pick a folder.",
    }),
  );
  r.queryHandler(
    defineEntityDetailHandler("folder", folderEntity, {
      access,
      description:
        "Reads one folder of the caller's tenant by id, returning its name and parent id; use it to confirm a folder id is real before filing something into it.",
    }),
  );

  // Single-membership assignment — hand-written (deterministic id + move/restore).
  r.writeHandler(createSetFolderHandler(access, assignmentExecutor));
  r.writeHandler(createClearFolderHandler(access, assignmentExecutor));
  r.queryHandler(
    defineEntityListHandler("folder-assignment", folderAssignmentEntity, {
      access,
      description:
        "Lists the folder-membership rows of the caller's tenant; filter on entityId to learn which folder one entity sits in, or on folderId to list everything filed into a folder.",
    }),
  );
}

export type FoldersFeatureOptions = {
  /** Access rule for all folder write/read paths. Default { roles: ["TenantAdmin","TenantMember"] }.
   *  Adopt the host's model — e.g. { openToAll: { reason: "..." } } when any authenticated
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
  /** Row-level ownership on the folder-assignment rows themselves — orthogonal
   *  to `access`, which only gates whether a caller may dispatch set/clear/list
   *  at all. Not needed to keep a caller from reading assignments on host
   *  entities they can't see: that gate is default-on and derives
   *  from the entity's `parentRef`. Use `ownership.read` for an ADDITIONAL row
   *  rule on the assignment row itself; it is AND-ed with the host-visibility
   *  gate. Applies only to `folder-assignment`; the `folder` catalog stays
   *  tenant-wide by design.
   *
   *  `ownership.write` is separate and does NOT affect list/read. It's consulted
   *  by the framework's generic delete/forget/restore paths. A `from()` rule
   *  there also gates GDPR erasure (`forget`): if the rule's role map doesn't
   *  cover whatever role the erasure/retention pipeline runs as, `forget` denies
   *  instead of crypto-shredding — a silent Art.17 failure, not a thrown error.
   *  Make sure any `ownership.write` you set covers that role, or leave it unset. */
  readonly ownership?: EntityDefinition["access"];
  /** Registered entities a row may hang off (entityType). Required and non-empty: the read gate
   *  builds one SQL branch per host. Every path still checks that the host row is visible to the
   *  caller through the host's own read path. */
  readonly parents: readonly string[];
};

export function createFoldersFeature(opts: FoldersFeatureOptions): FeatureDefinition {
  assertNoWhereRuleInOwnershipWrite("createFoldersFeature", opts.ownership?.write);
  if (opts.parents.length === 0) {
    throw bootRuleError(FOLDERS_BOOT_RULES.emptyParentsAllowlist, {
      message:
        "createFoldersFeature({ parents }): parents must not be an empty array — " +
        "an empty allowlist rejects every assignment. List at least one host entity.",
    });
  }
  const access = resolveFeatureAccess(opts, DEFAULT_FOLDER_ACCESS);
  return defineFeature(FOLDERS_FEATURE_NAME, (r) =>
    registerFolders(r, access, opts.toggleable, opts.ownership, opts.parents),
  );
}
