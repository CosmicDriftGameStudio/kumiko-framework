---
"@cosmicdrift/kumiko-framework": minor
---

fw#2223: the tenant `/members` screen is now a single `projectionList` (`tenant:query:team:list`) merging active memberships and pending invitations into one sortable, searchable, status-faceted list, instead of a custom two-card component. Cancelling a pending invitation is a danger-styled row action visible only on pending rows.

`createTenantFeature()` gains an optional `inviteScreen` flag (default `false`). When set, it also registers a drawer-hosted `actionForm` (`kind: "drawer"`) on the toolbar's "invite" button, bound to `auth-email-password`'s `invite-create` write-handler. That handler only exists when the app also configures `createAuthEmailPasswordFeature({ invite: {...} })` — the boot validator rejects a cross-feature `actionForm` handler QN that isn't registered, so `tenant` cannot wire this unconditionally without breaking apps that mount `auth-email-password` without `invite` configured. Opt in with `createTenantFeature({ inviteScreen: true })` once `invite` is configured.

Role editing stays out of scope — `updateMemberRoles` remains SystemAdmin-only and is not reachable from this screen. The previous `members`/`invitations` query handlers and their custom React component are unaffected and still registered for existing callers.
