---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-renderer": minor
---

A named filter on an entity list now reaches the client with its full access rule, checked by `isUiAccessGranted`.

<!-- kumiko-changes
feature: framework
type: breaking
title: Named filter refs carry `access` instead of `roles`
detail: `NamedListFilterRef.roles` is replaced by `access` (an `AccessRule`), set by the framework from the entity filter's rule; an authored `access` is dropped like `roles` was. The client offers a chip with `isUiAccessGranted(ref.access, userRoles)`, so `anySignedIn` and `openToAll` follow the same rules as role-gated screens: `anySignedIn` opens a rule only next to the `anonymous` role, and `openToAll` needs a non-empty reason. Before, every rule form other than a plain role list was offered to everyone. `isNamedFilterOffered` is removed from the renderer.
migration: Remove `roles` from `NamedListFilterRef` literals in screens (it was framework-owned and dropped anyway); the restriction is declared once as `access` on the entity's `namedFilters` entry. Code reading `ref.roles` from a built app schema reads `ref.access` instead.
-->
