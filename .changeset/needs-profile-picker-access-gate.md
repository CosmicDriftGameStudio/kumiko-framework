---
"@cosmicdrift/kumiko-bundled-features": patch
---

`compliance-profiles`'s `needs-profile` query used to tell a TenantAdmin they still need to pick a compliance profile even when the feature's `access` option (e.g. `access.systemAdmin`) had removed them from the profile-picker screen — a nag pointing at a screen they can no longer open. The query now checks whether the caller's roles actually intersect the picker's configured access before reporting `needsSelection: true`, returning `reason: "picker_not_accessible_for_role"` instead when they don't. Call access to the endpoint itself is unchanged (still TenantAdmin-only).
