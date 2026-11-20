---
"@cosmicdrift/kumiko-renderer": patch
---

`ExtensionSectionProps.reloadHost` lets an extension section reload the host record after its own write.

<!-- kumiko-changes
feature: renderer
type: improvement
title: Extension sections can reload the host record
detail: ExtensionSectionProps gains the optional reloadHost(). Wherever the host screen can refetch its record (entityEdit and projectionDetail sections and slots: header, titleAction, afterForm, afterSection, footer), it refetches the detail query, so derived host content such as next-step guidance updates after the section wrote data itself. It is undefined in list-header and dashboard mounts. Additive, nothing to do for apps.
-->
