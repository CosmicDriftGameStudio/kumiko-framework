---
"@cosmicdrift/kumiko-bundled-features": patch
---

ConfirmAccountDeletionScreen now distinguishes a failed request (network/server error → generic "something went wrong" message) from an invalid-or-expired token, instead of always showing the invalid-token banner on any failure.
