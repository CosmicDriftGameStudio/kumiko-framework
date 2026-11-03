---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-server-runtime": minor
"@cosmicdrift/kumiko-dev-server": patch
---

`screenShortId` is exported from the engine barrel, helpdesk tables get indexes, an agent tool call can read global entities, legacy contact data is exported, erased and expired from the event log, `providerTexts` take a per-provider refund link, and only a SystemAdmin can start or see paid system-check probes.

<!-- kumiko-changes
feature: readiness
type: breaking
title: includePaid from a non-SystemAdmin is rejected
detail: `readiness:write:run-probes` ignored the role of the caller for `includePaid`, so any TenantAdmin could trigger paid probes. A TenantAdmin that sends `includePaid: true` now gets `access_denied` and no run is started. `readiness:query:latest-summary` reports `hasPaidProbes` as false for everyone but a SystemAdmin, so the paid action on the system check screen is only offered to a SystemAdmin.
migration: |
  Send `includePaid: true` only from a SystemAdmin session. Apps with their own button for the paid run must show it to a SystemAdmin only; a TenantAdmin request with `includePaid` now fails instead of running the free probes.
-->

<!-- kumiko-changes
feature: framework
type: fix
title: Agent tool calls can read global entities
detail: The generated list and detail query of a system-scoped feature that serves an entity with tenancy `global` (a catalog or lookup table) was refused inside an agent tool call with `agent.tool_not_allowed`. Such a read now runs with the caller's tenant scope; the system-scope default rate limit still applies. This only holds for the entity convention handlers without an `escapeHatch`; hand-written queries, queries with an `escapeHatch` (e.g. `systemIdentity`), other entities and every write handler are still refused for agents.
-->

<!-- kumiko-changes
feature: helpdesk
type: fix
title: Legacy contact data is exported, erased and expired from the event log
detail: The user-data hooks for requests stored under the former contact names read the dropped `read_contact_requests` and `read_contact_replies` tables, so the export failed and the forget run reported an error on an app that never had those tables. They now fold the `contact-request` and `contact-reply` event streams instead: the export lists the requests of the user (by user id, or by verified email for anonymous ones) with their replies, the forget run purges attachments, erases the record keys and archives the streams. A new maintenance job `helpdesk:job:legacy-contact-retention` applies the retention period to old legacy requests and replies. Deleting a user also erases the notes written on their helpdesk requests and legacy requests.
-->

<!-- kumiko-changes
feature: helpdesk
type: improvement
title: HELPDESK_REQUEST_ENTITY is exported from the helpdesk entry
detail: `HELPDESK_REQUEST_ENTITY` comes from `@cosmicdrift/kumiko-bundled-features/helpdesk` next to the other helpdesk constants.
-->

<!-- kumiko-changes
feature: helpdesk
type: improvement
title: Indexes for helpdesk requests and replies
detail: All helpdesk rows live in the system tenant, so the tenant index selected nothing. `read_helpdesk_requests` gets indexes on (tenant_id, status) and (tenant_id, reporter_user_id), `read_helpdesk_replies` on (tenant_id, request_id).
migration: |
  Run `bun kumiko-schema generate` in the app to pick up the new indexes.
-->

<!-- kumiko-changes
feature: billing-foundation
type: improvement
title: providerTexts take a refund link per provider
detail: `consumerProtection.providerTexts[provider].refundLink` (one link, or one per consent locale) replaces `legalLinks.refund` for that provider; a provider without it falls back to `legalLinks.refund`. It is validated like `legalLinks`, shown next to the other links while that provider is selected in the checkout dialog, and with `documentsAcknowledgement` it selects the text variant and the consent text version of that provider. `billing-plans` lists the override under `providers[].consumerProtection`.
-->

<!-- kumiko-changes
feature: server-runtime
type: improvement
title: The stripe boot option passes clientConfig
detail: `billing: { stripe: { clientConfig } }` is handed to the subscription-stripe feature, so an app can set the Stripe client configuration (API version, retries, host) from the boot options.
-->

<!-- kumiko-changes
feature: dev-server
type: fix
title: Deploy Dockerfile template no longer mentions migrate-step.sh
detail: The comment in `deploy/Dockerfile.template` named a compose-host migrate step that the scaffold does not generate. It now only names the migrate-db initContainer of the k3s deployment.
-->
