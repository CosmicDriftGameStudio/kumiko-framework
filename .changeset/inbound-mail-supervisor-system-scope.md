---
"@cosmicdrift/kumiko-bundled-features": patch
---

The inbound mail supervisor reads accounts, sync cursors and seen messages of all tenants in the system scope, so polling no longer finds zero accounts when the app passes the row-level-security enforcing pool.

<!-- kumiko-changes
feature: inbound-mail-foundation
type: fix
title: Mail polling works with the row-level-security enforcing pool
detail: createInboundMailSupervisor opens its own system scope for the cross-tenant reads and writes of accounts, cursors and seen messages. Before, passing the enforcing pool as db made every poll see no accounts.
-->
