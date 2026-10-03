---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

Harden system role, invitations query, tenant teardown and addMember

The system role can no longer be minted into a session through a user's global roles. invitations.query returns an explicit field allowlist and exposes globalRoles only to a SystemAdmin. The tenant destruction sweep waits 60 seconds after the grace period ends so the teardown gate can settle. Behaviour change: tenant:write:addMember now adds members to a foreign tenant only from the framework system context; a SystemAdmin request user is limited to their own tenant and gets 403 otherwise.

<!-- kumiko-changes
feature: tenant
type: improvement
title: Harden system role, invitations query, tenant teardown and addMember
-->
