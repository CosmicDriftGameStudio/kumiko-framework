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
- **Filing the change** — the client reacts to `field_approval_required` by
  calling `field-approval:write:request-change` with
  `{ entityType, entityId, fieldName, value }`.
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
