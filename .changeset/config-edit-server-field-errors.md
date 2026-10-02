---
"@cosmicdrift/kumiko-headless": patch
"@cosmicdrift/kumiko-renderer": patch
---

A configEdit screen shows a server validation error at the field whose value was rejected, for example the pattern message of a Stripe webhook secret. Before, it showed only the generic "Invalid input." banner. `groupIssuesByPath` is exported from `@cosmicdrift/kumiko-headless`.

<!-- kumiko-changes
feature: renderer
type: fix
title: configEdit shows server validation errors at the affected field
detail: |
  `config:write:set` reports its issues at path `value`. The configEdit submit maps the issues of the failed batch command (`failedIndex`) to that command's field, and RenderEdit puts server field issues from a `customSubmit` into the form controller, the same way `controller.submit()` does. The banner stays for issues no rendered field can show and for network failures.
migration: |
  No code change needed.
-->
