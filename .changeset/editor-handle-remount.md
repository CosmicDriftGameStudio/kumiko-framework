---
"@cosmicdrift/kumiko-bundled-features": patch
---

Template editors report their insert handle from the React commit, so a remounted editor keeps it.

<!-- kumiko-changes
feature: template-resolver
type: fix
title: Rail inserts no longer do nothing after the placeholder labels load
detail: Inserting a placeholder into the subject, preheader, header chip or footer field could silently do nothing once the placeholder labels had loaded, because the replaced editor unregistered the handle of its remounted successor. The editors now report their handle from the React commit instead of tiptap's create and destroy callbacks.
-->
