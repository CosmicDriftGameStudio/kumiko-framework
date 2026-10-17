---
"@cosmicdrift/kumiko-bundled-features": patch
---

invite-create is no longer exposed to agents

<!-- kumiko-changes
feature: auth-email-password
type: fix
title: invite-create is no longer exposed to agents
detail: The admin invite-create handler is now opted out of the agent tool catalog with agent: { expose: false }, like the other invite handlers, because it mails an accept link to an arbitrary address.
-->
