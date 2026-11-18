# Field Approval

Four-eyes approval for a payment-relevant field. The `contact` entity declares
`access: { approve: ["Accountant"] }` on `iban`. A `PropertyManager` may edit
the contact but cannot change the IBAN directly; a second person with the
`Accountant` role applies the change.

## What it shows

- **`access.approve` on the field** — the executor refuses a create or update
  that changes the field by a user without an approve role: 403 with
  `details.reason: "field_approval_required"`. Unchanged values pass, so a
  form that resubmits the old IBAN still saves.
- **Filing the change** — `field-approval:query:pending-changes` with an
  `entityType` also returns `gatedFields`: the fields the caller may write
  but must request (`entityId: null` for a record not created yet). The edit
  form shows them read-only with "Request change"; its drawer files the
  changed ones as `field-approval:write:request-change` commands
  (`{ entityType, entityId, fieldName, value }`) in one batch, so the form
  keeps a single Save. The 403 stays as the safety net and shows as a field
  error.
- **Deciding** — `field-approval:query:pending-changes` lists the open
  requests with their value; `approve-change` applies one, `reject-change`
  declines it (the requester may withdraw their own). Both pin the request
  `version`, so a value re-submitted in between is never approved unseen.
  Whoever filed a request cannot approve it.
- **Mounting** — `createFieldApprovalFeature({ parents: ["contact"] })` must
  list every host entity with an approval-gated field; boot validation fails
  otherwise.
- **Encryption** — the requested value of a PII field is stored encrypted under
  the host record's subject, so forgetting the host makes it unreadable.
