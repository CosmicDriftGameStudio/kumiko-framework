---
"@cosmicdrift/kumiko-bundled-features": patch
---

`form-draft` no longer hard-requires the `config` feature (`r.requires("config")` → `r.optionalRequires("config")`). The retention-days config key only resolves when `config` is mounted; the cleanup job already falls back to `FORM_DRAFT_DEFAULT_RETENTION_DAYS` otherwise, so the hard dependency broke apps mounting `form-draft` without `config` for no reason.

Also fixed in this release:
- **GDPR/Art. 17**: `tenantInvitationDeleteHook` compared a plaintext `userId` against the encrypted `invitedBy` column, which never matched under active KMS — invitations a user sent were never anonymized on forget. It now loads the tenant's invitations and decrypts `invitedBy` per row for the comparison.
- `form-draft-user-data`'s delete hook now throws instead of silently swallowing a failed draft delete, so a failure rolls back the forget sub-transaction and gets retried instead of marking the user Deleted with PII still present.
- `form-draft` cleanup/discard no longer releases a storage file whose `file_refs` row predates the draft (e.g. a domain entity's pre-existing photo pulled into an edit-mode draft) — only files uploaded during the draft's own lifetime are release-eligible. The cleanup job also now deletes stale drafts through the event-sourced executor instead of a raw `DELETE`, so a projection rebuild can no longer resurrect a deleted draft.
- `template-resolver` collection entries now read and write `contentFormat` consistently instead of silently defaulting saves to `"markdown"`.
