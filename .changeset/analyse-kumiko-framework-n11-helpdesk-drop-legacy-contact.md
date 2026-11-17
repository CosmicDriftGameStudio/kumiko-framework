---
"@cosmicdrift/kumiko-bundled-features": minor
---

`helpdesk` drops its handling of data stored before the contact to helpdesk rename.

<!-- kumiko-changes
feature: helpdesk
type: breaking
title: helpdesk no longer handles pre-rename contact data
detail: The `contact-request` user-data hook (export and deletion of requests stored under the former `contact` feature), the boot job `legacy-contact-config` that copied the former `contact:config:*` keys to the helpdesk keys, and the daily maintenance job `legacy-contact-retention` are gone. Events under the former `contact-request` and `contact-reply` aggregates stay in the event log and stay inert; nothing reads, exports, erases or expires them anymore. The orphan scheduler cleanup removes the schedulers of the dropped jobs.
migration: An app that still has `contact-request` or `contact-reply` streams or `contact:config:*` rows removes or migrates them before it upgrades. Apps without such data change nothing.
-->
