// @runtime client
// form-draft bundle constants — feature-name + qualified handler/query names.
//
// Part of CosmicDriftGameStudio/kumiko-framework#1883 (wizard mode), issue #1889.

import type { AccessRule } from "@cosmicdrift/kumiko-framework/engine";

export const FORM_DRAFT_FEATURE_NAME = "form-draft";

// Qualified handler/query names (QN format: scope:type:name). Clients
// reference the object instead of magic strings.
export const FormDraftHandlers = {
  save: "form-draft:write:save",
  discard: "form-draft:write:discard",
} as const;

export const FormDraftQueries = {
  get: "form-draft:query:get",
} as const;

// Any authenticated tenant user may save/discard/read their OWN draft — the
// per-row ownerId check in the handlers (not roles) is what keeps a draft
// private to the user who created it. See handlers/*.ts.
export const FORM_DRAFT_ACCESS: AccessRule = { openToAll: true };

// Unique index name — shared between entity.ts (index declaration) and
// handlers/save.write.ts (unique-violation race detection).
export const FORM_DRAFT_UNIQUE_KEY_CONSTRAINT = "read_form_drafts_tenant_owner_key_uniq";

export const FORM_DRAFT_KEY_MAX_LENGTH = 256;
