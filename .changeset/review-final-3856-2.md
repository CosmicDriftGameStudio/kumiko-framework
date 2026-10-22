---
"@cosmicdrift/kumiko-document-designer": patch
---

The mail editor drops a record pick when the declared variables of the template change. Before, a pick kept travelling with preview and test mail and, once a variable was removed and added again, brought its old value back. A pick for a variable that is not declared is still filtered out of the request.

<!-- kumiko-changes
feature: document-designer
type: fix
title: mail editor resets the record pick when variables change
detail: The picked record values are cleared as soon as the set of declared variables changes, so a removed or renamed variable no longer leaves a stale pick behind and a re-added variable does not revive an old value.
-->
