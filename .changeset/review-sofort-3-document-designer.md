---
"@cosmicdrift/kumiko-document-designer": patch
---

Layout validation waits for a pause in typing, quick mail uploads get distinct keys, and a failed system publish still reloads the editor

<!-- kumiko-changes
feature: document-designer
type: fix
title: Debounced layout validation, collision-free resource keys and reload after a half-finished system publish
detail: The layout editor sent a validate query (with an MJML compile) on every change; it now waits 400 ms after the last edit. A second upload with the same file name before the row refetch finished reused the first key; keys handed out earlier are now remembered. When a SystemAdmin saved a mail version but publishing it failed, the editor kept the old state with the error shown; it now reloads so the stored version is visible.
-->
