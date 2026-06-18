// @runtime client
// tags bundle constants — feature-name + qualified handler/query names.
//
// Spec: kumiko-platform/docs/plans/features/tags.md
// C#1 design: money-horse/docs/plans/cashcolt-vertragspakete.md

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
// role vocabulary (e.g. "Admin"/"Editor") override via createTagsFeature({ roles })
// — otherwise the hard-wired QNs are access_denied for their users.
export const DEFAULT_TAG_ROLES = ["TenantAdmin", "TenantMember"] as const;
