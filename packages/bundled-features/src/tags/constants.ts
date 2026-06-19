// @runtime client
// tags bundle constants — feature-name + qualified handler/query names.
//
// Spec: kumiko-platform/docs/plans/features/tags.md
// C#1 design: money-horse/docs/plans/cashcolt-vertragspakete.md

import type { AccessRule } from "@cosmicdrift/kumiko-framework/engine";

export const TAGS_FEATURE_NAME = "tags";

// Qualified handler names (QN format: scope:type:name). Clients reference the
// object instead of magic strings (mirror custom-fields' Handlers/Queries).
export const TagsHandlers = {
  createTag: "tags:write:create-tag",
  assignTag: "tags:write:assign-tag",
  removeTag: "tags:write:remove-tag",
} as const;

export const TagsQueries = {
  // defineEntityListHandler("tag", ...) → "tag:list", qualified by the feature
  // to "tags:query:tag:list".
  tagList: "tags:query:tag:list",
  assignmentList: "tags:query:tag-assignment:list",
} as const;

// Default RBAC for every tag write/read path. Tags are a low-sensitivity
// collaboration tool, so both tenant roles may use them. Apps with their own
// role vocabulary (e.g. "Admin"/"Editor") override via createTagsFeature({ roles }),
// or adopt the host's whole access model with createTagsFeature({ access }) —
// otherwise the hard-wired QNs are access_denied for their users.
export const DEFAULT_TAG_ROLES = ["TenantAdmin", "TenantMember"] as const;

// The default access rule applied to every tag handler when the app passes
// neither `access` nor `roles`. createTagsFeature({ access: { openToAll: true } })
// makes tagging reachable for any authenticated tenant user — matching apps
// whose other handlers are openToAll rather than role-gated.
export const DEFAULT_TAG_ACCESS: AccessRule = { roles: DEFAULT_TAG_ROLES };
