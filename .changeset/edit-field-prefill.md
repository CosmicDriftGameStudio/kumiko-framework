---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

An edit field can be pre-filled when the create form opens. `{ field: "date", prefill: { kind: "today" } }` fills a date field with today's calendar date in the user's time zone, `{ field: "inspector", prefill: { kind: "currentUser", property: "displayName" } }` (or `email`, `id`) fills from the signed-in user. Only empty values are filled, the update form and values from URL params or a handoff are never touched, and unlike a field `default` nothing is applied server-side. The auth session now provides the user through the new `CurrentUserProvider` / `useOptionalCurrentUser()` renderer context, and `user:me` additionally returns `effectiveTimeZone`, the user's effective IANA zone (own setting, else tenant, else UTC); without a user zone the locale resolver's zone is used.

<!-- kumiko-changes
feature: types
type: improvement
title: EditFieldSpec.prefill
detail: New EditFieldPrefill, today or currentUser with displayName, email or id, on the object form of EditFieldSpec.
-->

<!-- kumiko-changes
feature: framework
type: improvement
title: Boot check for edit field prefill
detail: validateBoot allows today only on date fields, currentUser displayName and email only on text fields and id on text or reference fields.
-->

<!-- kumiko-changes
feature: renderer
type: improvement
title: Create form prefill and CurrentUserProvider
detail: EntityEditCreateBody applies prefill to empty initial values. New exports CurrentUser, CurrentUserProvider and useOptionalCurrentUser.
-->

<!-- kumiko-changes
feature: user
type: improvement
title: user:me returns effectiveTimeZone, SessionProvider provides the current user
detail: The me query adds effectiveTimeZone (ctx.tz.user), CurrentUserProfile.effectiveTimeZone is parsed by fetchCurrentUser and SessionProvider wraps its children in CurrentUserProvider.
-->
