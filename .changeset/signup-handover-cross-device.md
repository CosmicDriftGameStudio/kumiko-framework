---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-framework": minor
---

magic-link self-signup can now claim a try-first tenant-handover grant across devices

<!-- kumiko-changes
feature: auth-email-password
type: improvement
title: magic-link self-signup can now claim a try-first tenant-handover grant across devices
detail: |
  An anonymous visitor's tenant-handover grant (packages/bundled-features/src/
  tenant-handover) lives only in the browser that minted it, but the signup
  activation link is often opened somewhere else (a different device, or the
  mail app's in-app browser) — the grant never reaches signup-confirm there.
  requestSignup(email, handover?) can now pass { entityType, token } alongside
  the email; signup-request verifies the grant against its anchor row
  (read-only, tenant-handover's own redeemRowBoundGrant with commitAnchor
  skipped) and binds only { entityType, rowId, sourceTenantId } to the signup
  token in Redis — never the grant token or the email. A resend without a
  fresh grant carries the previous verified binding to the new token instead
  of dropping it. signup-confirm reads the binding after provisioning the new
  tenant, mints a fresh short-lived (5 min) grant server-side, and redeems it
  via the same claim write tenant-handover already exposes — riding the
  confirm handler's own transaction. A benign rejection (already claimed
  elsewhere, forged grant, row gone) never fails the signup; any other claim
  failure (e.g. a non-transferable child row) rolls the whole signup back and
  leaves the activation link retryable, instead of committing a partial move
  next to a new account. On success
  the signup-confirm response gains an optional `handover: { entityType, id }`
  field; auth-client's confirmSignup result type reflects it. New extension
  point `signupHandover` (packages/bundled-features/src/shared/signup-handover.ts)
  lets tenant-handover provide this without auth-email-password importing it
  directly; tenant-handover self-registers as its own provider.
-->
