---
"@cosmicdrift/kumiko-bundled-features": patch
---

Events of removed workflow, mail-thread and ingest-progress types keep their technical stance in the audit log.

<!-- kumiko-changes
feature: audit
type: fix
title: Retired event types stay classified in the audit log
detail: Events of types that are no longer registered stay in the append-only log. `RETIRED_EVENT_STANCES` keeps the technical stance of the former workflow system events, `inbound-mail-foundation:event:mail-thread-updated` and `document-ingest-foundation:event:document-ingest-progress`, so they do not surface unlabelled in the default audit list; `TECHNICAL_EVENT_TYPES` and `eventLabelKeyOf` include them.
-->
