// @runtime client
// folders bundle constants — feature-name + qualified handler/query names.
//
// Spec: kumiko-platform/docs/plans/folders-feature.md

import type { AccessRule } from "@cosmicdrift/kumiko-framework/engine";

export const FOLDERS_FEATURE_NAME = "folders";

// Registry name for the drop-in <FolderSection> component. Apps reference it in a
// screen schema via `component: { react: { __component: FOLDER_SECTION_EXTENSION_NAME } }`
// after mounting foldersClient(); the component is also importable directly for
// standalone use from `@cosmicdrift/kumiko-bundled-features/folders/web`.
export const FOLDER_SECTION_EXTENSION_NAME = "FolderSection";

// Qualified handler names (QN format: scope:type:name). The folder catalog uses
// generic defineEntity*Handler (create/update/delete) → "folder:<verb>" qualified
// to "folders:write:folder:<verb>". update covers rename (and, later, reparent).
// set-folder/clear-folder are the hand-written single-membership handlers.
export const FoldersHandlers = {
  createFolder: "folders:write:folder:create",
  updateFolder: "folders:write:folder:update",
  deleteFolder: "folders:write:folder:delete",
  setFolder: "folders:write:set-folder",
  clearFolder: "folders:write:clear-folder",
} as const;

export const FoldersQueries = {
  folderList: "folders:query:folder:list",
  folderDetail: "folders:query:folder:detail",
  assignmentList: "folders:query:folder-assignment:list",
} as const;

// Default RBAC for every folder write/read path. Like tags, folders are a
// low-sensitivity organisation tool, so both tenant roles may use them. Apps
// with their own role vocabulary override via createFoldersFeature({ roles }),
// or adopt the host's access model with createFoldersFeature({ access }).
export const DEFAULT_FOLDER_ROLES = ["TenantAdmin", "TenantMember"] as const;

export const DEFAULT_FOLDER_ACCESS: AccessRule = { roles: DEFAULT_FOLDER_ROLES };
