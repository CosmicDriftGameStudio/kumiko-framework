---
"@cosmicdrift/kumiko-bundled-features": patch
---

`helpdesk` keeps exporting, erasing and expiring requests and replies stored before the contact to helpdesk rename.

<!-- kumiko-changes
feature: helpdesk
type: improvement
title: helpdesk still exports and forgets pre-rename contact data
detail: Events under the former `contact-request` and `contact-reply` aggregates contain personal data and stay in the event log, so access and erasure keep reaching them. The `contact-request` user-data hook exports them and deletes them on forget (record keys erased, streams archived, attached note bodies erased), the daily maintenance job `legacy-contact-retention` expires them after the helpdesk `keepFor`, and the boot job `legacy-contact-config` still copies the former `contact:config:*` keys to the helpdesk keys. Nothing needs to be removed or migrated before the upgrade.
-->
