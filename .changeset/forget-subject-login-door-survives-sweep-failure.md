---
"@cosmicdrift/kumiko-bundled-features": patch
---

forget-subject closes the user's login before the derived-data sweep and commits it independently

<!-- kumiko-changes
feature: crypto-shredding
type: fix
title: forget-subject keeps the user status flip and PAT revocation when the sweep fails
detail: The user is set to Deleted and its personal access tokens are revoked right after the key erase, in their own transaction on the outside-transaction db. A failing blind-index or search sweep still makes the handler throw so the cleanup can be retried, but it no longer rolls the login door back. Without an outside-transaction db the previous in-transaction savepoint path is used. A failure while closing the login door of an existing user now fails the forget (retry is safe) instead of passing silently; subjects without a user row are skipped.
-->
