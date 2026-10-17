---
"@cosmicdrift/kumiko-bundled-features": minor
---

A draft no longer replaces the active template

Saving a draft over an active template now stores it beside the active version (new column draft) instead of overwriting it; publish promotes the draft, the new handlers discard-draft and discard-draft-system throw it away. find-by-id and layout-source return the working version (open draft, else the stored one) with active { version, since }; overview rows gain draftVersion and activeSince. The resolver keeps serving the active version.

<!-- kumiko-changes
feature: template-resolver
type: breaking
title: A draft no longer replaces the active template
detail: Saving a draft (upsert-tenant default, copy-locale, import-bundle with status draft) over an active template stores it beside the active version in the new column draft instead of overwriting content, meta and status; resolveTemplate, resolveLayout, preview without content and sends keep using the active version. publish and publish-system promote an open draft (the publish gate checks the draft) and record activeVersion and activeSince; the new handlers discard-draft and discard-draft-system drop it and refuse with no_draft when none is open. find-by-id and layout-source return the working version (the open draft with status draft, else the stored one) plus active { version, since }, null when nothing is served. overview keeps status and version of the served version and adds draftVersion and activeSince. A draft over a row that is not active (new, draft or archived) behaves as before. A tenant never sees system draft content: find-by-id, layout-source, overview, copy-locale and diff-to-system apply a system draft only for a SystemAdmin and hide system rows that were never served; list leaves those rows out too. Version numbers shown for an active row are the served version (activeVersion): resolveTemplate / resolveLayout results, tenant-overrides rows and the override diff no longer show the save counter that drafts raise.
migration: |
  Run kumiko schema generate and apply the migration before deploying: it adds the nullable columns draft, active_version and active_since to read_template_resources. No rebuild needed.
-->
