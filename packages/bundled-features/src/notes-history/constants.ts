// @runtime client
// notes-history bundle constants — feature-name + qualified handler/query names.
//
// Spec: kumiko-platform/docs/plans/notes-history-bundle.md

import type { AccessRule } from "@cosmicdrift/kumiko-framework/engine";

export const NOTES_HISTORY_FEATURE_NAME = "notes-history";

// Registry name for the drop-in <NotesSection> component. Apps reference it
// in a screen schema via `component: { react: { __component: NOTES_SECTION_EXTENSION_NAME } }`
// after mounting notesHistoryClient(); also importable directly from
// `@cosmicdrift/kumiko-bundled-features/notes-history/web` for standalone use.
export const NOTES_SECTION_EXTENSION_NAME = "NotesSection";

// Qualified handler/query names (QN format: scope:type:name). Clients
// reference the object instead of magic strings.
export const NotesHistoryHandlers = {
  addNote: "notes-history:write:add-note",
} as const;

export const NotesHistoryQueries = {
  noteList: "notes-history:query:note-entry:list",
} as const;

// Default RBAC: any tenant member may read and write notes on entities they
// can already see — same low-sensitivity-collaboration-tool default as tags.
// Apps with their own role vocabulary override via
// createNotesHistoryFeature({ roles }) / ({ access }).
export const DEFAULT_NOTES_HISTORY_ROLES = ["TenantAdmin", "TenantMember"] as const;

export const DEFAULT_NOTES_HISTORY_ACCESS: AccessRule = {
  roles: DEFAULT_NOTES_HISTORY_ROLES,
};
