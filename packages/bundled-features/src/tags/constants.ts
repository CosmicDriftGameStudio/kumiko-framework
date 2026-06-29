// @runtime client
// tags bundle constants — feature-name + qualified handler/query names.
//
// Spec: kumiko-platform/docs/plans/features/tags.md
// C#1 design: money-horse/docs/plans/cashcolt-vertragspakete.md

import type { AccessRule } from "@cosmicdrift/kumiko-framework/engine";

export const TAGS_FEATURE_NAME = "tags";

// Registry name for the drop-in <TagSection> component. Apps reference it in a
// screen schema via `component: { react: { __component: TAGS_SECTION_EXTENSION_NAME } }`
// after mounting tagsClient(); the component is also importable directly for
// standalone use from `@cosmicdrift/kumiko-bundled-features/tags/web`.
export const TAGS_SECTION_EXTENSION_NAME = "TagSection";

// Registry name for the <TagFilter> header-slot control. A host entityList wires
// it via `slots: { header: { react: { __component: TAGS_FILTER_EXTENSION_NAME } } }`
// after mounting tagsClient(); the renderer passes it the list's screenId.
export const TAGS_FILTER_EXTENSION_NAME = "TagFilter";

// Screen-id of the standalone Tags management screen (custom screen rendering
// TagManager). Qualified = "tags:screen:tag-list"; the app places it via r.nav.
export const TAGS_SCREEN_ID = "tag-list";

// Qualified handler names (QN format: scope:type:name). Clients reference the
// object instead of magic strings (mirror custom-fields' Handlers/Queries).
export const TagsHandlers = {
  createTag: "tags:write:create-tag",
  updateTag: "tags:write:update-tag",
  deleteTag: "tags:write:delete-tag",
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
