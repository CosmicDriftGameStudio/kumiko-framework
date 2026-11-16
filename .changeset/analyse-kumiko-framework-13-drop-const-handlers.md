---
"@cosmicdrift/kumiko-bundled-features": minor
---

The tags and notes-history features no longer export prebuilt handler constants; build handlers through their factories.

<!-- kumiko-changes
feature: tags
type: breaking
title: Prebuilt tag and note handler constants removed
detail: `createTagHandler`, `assignTagHandler`, `deleteTagHandler` and `removeTagHandler` from the tags feature and `addNoteHandler` from notes-history are gone. They were default-access copies of the factories and nothing registered them; the features themselves already used the factories. Inside custom-fields the same backwards-compat constants and the `lib/quota.ts` re-export are removed, and the feature builds every handler through its factory, with unchanged default roles.
migration: Replace `createTagHandler` with `createCreateTagHandler()`, `assignTagHandler` with `createAssignTagHandler()`, `deleteTagHandler` with `createDeleteTagHandler()`, `removeTagHandler` with `createRemoveTagHandler()` and `addNoteHandler` with `createAddNoteHandler()`; pass an access rule where you need one other than the default.
-->
