---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-renderer": minor
---

An action-form preview fact or success fact can take `type: "file"`: the value is a stored file id (or an array of them) and shows with name, download link and PDF preview, so a user can open a mail attachment before sending.

<!-- kumiko-changes
feature: renderer
type: improvement
title: Action-form facts can show a stored file
detail: A preview or success fact with type "file" reads a FileRef id or an array of ids from the result and renders the file list with name, download link and inline PDF preview.
-->
