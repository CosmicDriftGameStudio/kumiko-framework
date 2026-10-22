---
"@cosmicdrift/kumiko-bundled-features": minor
---

The SMTP transport works without authentication: an empty `authUser` builds a transport without login and never reads the password. A set `authUser` still requires the stored password.

<!-- kumiko-changes
feature: mail-transport-smtp
type: improvement
title: SMTP authentication is optional
detail: authUser is no longer a required key and the SMTP password secret no longer counts as missing in readiness. With an empty user the transport connects without auth, which suits internal relays; with a user set, a missing password still fails the send.
-->
