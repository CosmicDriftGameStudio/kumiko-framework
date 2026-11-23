---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-es": patch
"@cosmicdrift/kumiko-locale-fr": patch
"@cosmicdrift/kumiko-locale-it": patch
"@cosmicdrift/kumiko-renderer": patch
---

document-draft editor returns to its caller, and drafts an app prints itself can no longer be finalized.

<!-- kumiko-changes
feature: document-draft
type: improvement
title: Draft editor returns to the calling screen; unfinalizedTemplates for app-printed drafts
detail: Opened with `returnTo`, the editor shows a Back button and goes back there after finalize or discard, ahead of `subjectScreens`. The new option `unfinalizedTemplates` lists template slugs whose drafts stay open because the app prints them itself (for example one letter per recipient at send): `finalize` answers 422 `document_draft_not_finalizable`, the `blocks` query reports `finalizable: false` and the editor hides Finalize.
-->

<!-- kumiko-changes
feature: document-draft
type: improvement
title: subjectAccess adds a role rule per subject type
detail: The new option `subjectAccess` maps a subject type to an `AccessRule` that create, patch, save, finalize, revise, discard, blocks and by-subject check on top of `access`. A user who misses the rule gets the same 404 as for an unreadable subject. Keys must be in `subjectTypes`, otherwise boot fails; subject types without an entry stay governed by `access` alone.
-->

<!-- kumiko-changes
feature: renderer
type: improvement
title: returnTo can point back to an actionForm opened for one record
detail: `resolveReturnTarget` now accepts an entity id for an `actionForm` screen as well as for `entityEdit` and `projectionDetail`, so a screen opened from a record's action form (such as the document-draft editor opened from a send mask) gets a Back button to that form.
-->

<!-- kumiko-changes
feature: renderer
type: improvement
title: A form's input survives a returnTo round trip
detail: `navigateWithReturnTo` takes the host form's current values as an optional fifth argument `carry`. They stay in memory, come back when the opened screen jumps home through returnTo, and win over the loaded record, so the jump leaves without the "discard changes?" question and the form can be submitted right away. Without `carry` nothing changes, and a navigation without it drops carry left behind by an earlier visit.
-->

<!-- kumiko-changes
feature: document-draft
type: fix
title: A rich text placeholder chip shows its text instead of HTML
detail: In the draft editor a filled `richText` variable showed its raw markup in the chip, for example `<p>hiermit erhalten Sie …</p>`. The chip now shows the plain text; the printed document is unchanged.
-->

<!-- kumiko-changes
feature: letter-foundation
type: improvement
title: Shorter file name for the merged letter PDF
detail: The merged PDF is stored as `letter-<last 8 characters of the id>.pdf` instead of the full uuid, so a file column in a letter list no longer crowds out its neighbours. Existing letters keep their stored name.
-->
