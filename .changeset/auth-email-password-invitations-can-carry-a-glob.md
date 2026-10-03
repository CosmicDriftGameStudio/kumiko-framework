---
"@cosmicdrift/kumiko-bundled-features": minor
---

Invitations can carry a global role (SystemAdmin), granted only on accept

New system-only handler auth-email-password:write:system-invite-create and bootstrapTenants() for idempotent passwordless provisioning. Tenant admins cannot set global roles; a re-invite clears a pending one.

<!-- kumiko-changes
feature: auth-email-password
type: breaking
title: Invitations can carry a global role (SystemAdmin), granted only on accept
migration: |
  New column read_tenant_invitations.global_roles: run `kumiko schema generate` and apply the migration before deploying.
-->
