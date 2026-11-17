---
"@cosmicdrift/kumiko-document-designer": patch
---

The PDF editor uploads a template resource with a key again.

<!-- kumiko-changes
feature: document-designer
type: fix
title: PDF editor resource upload sends the resource key
detail: The upload button in the PDF editor called `template-resolver:write:resource-upload` without `key`, which the handler schema rejects, so no image could be added there. The editor now derives the key from the file name and adds a numeric suffix when the template already links that key, as the mail editor does.
-->
