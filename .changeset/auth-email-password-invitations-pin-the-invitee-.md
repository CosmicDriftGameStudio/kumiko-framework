---
"@cosmicdrift/kumiko-bundled-features": minor
---

Invitations pin the invitee's membership version; superseded accept no longer relies on timestamps

<!-- kumiko-changes
feature: auth-email-password
type: breaking
title: Invitations pin the invitee's membership version; superseded accept no longer relies on timestamps
migration: |
  New nullable column read_tenant_invitations.membership_version: run `kumiko schema generate` and apply the migration before deploying. Invitations issued before the migration keep the timestamp comparison.
-->
