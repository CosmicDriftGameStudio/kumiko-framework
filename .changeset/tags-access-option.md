---
"@cosmicdrift/kumiko-bundled-features": minor
---

tags: `createTagsFeature` accepts an `access` rule so a host can adopt its own
authorization model for every tag write/read path — e.g.
`createTagsFeature({ access: { openToAll: true } })` for apps whose handlers are
open to any authenticated tenant user, instead of being pinned to the default
`{ roles: ["TenantAdmin","TenantMember"] }`. The `roles` shorthand stays as a
convenience (`{ roles }` → `{ access: { roles } }`); `access` takes precedence.
