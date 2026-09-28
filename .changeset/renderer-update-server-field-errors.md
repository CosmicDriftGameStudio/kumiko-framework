---
"@cosmicdrift/kumiko-headless": patch
"@cosmicdrift/kumiko-renderer": patch
---

Map server field errors of entity update forms back to their form fields, so they show inline and a tabs/wizard edit jumps to the step holding the erroring field.

<!-- kumiko-changes
feature: renderer
type: fix
title: Server validation errors on entityEdit update forms reach their fields again
detail: |
  The update form sends `{ id, version, changes }`, so server validation issues arrive as
  `changes.<field>`. The form controller stored them under that key, so no field showed the
  error, tabs/wizard layouts never jumped to the erroring tab (only the generic banner), and
  single-section forms failed silently. A new submit option `serverFieldPathPrefix` strips the
  nesting key; KumikoScreen's update form sets it to `changes.`. Paths without the prefix are unchanged.
-->
