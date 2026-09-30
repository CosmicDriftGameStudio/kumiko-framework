---
"@cosmicdrift/kumiko-bundled-features": patch
---

Accepting an invitation now grants the invited role to users who are already members of the inviting tenant

`invite-accept` and `invite-accept-with-login` used to skip the membership write when the user already belonged to the invited tenant, so a member without roles who accepted an invitation kept no roles and saw no accessible screen. The invited role is now added to the existing membership through the event-store executor. Existing roles are kept, because accepting an invitation never demotes. `invite-accept-with-login` builds the session from the resulting membership roles and rejects a reserved invitation role on this path with 403, the same as the other invite branches. An invitation issued before a later change to the membership is rejected with 409 and `TenantErrors.invitationSuperseded`; re-sending the invitation issues it anew.

<!-- kumiko-changes
feature: auth-email-password
type: fix
title: Accepting an invitation grants the invited role to existing members of the tenant
-->
