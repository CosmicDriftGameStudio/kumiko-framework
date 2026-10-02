---
"@cosmicdrift/kumiko-framework": patch
---

The search consumer no longer hands `sensitive` columns of the projection row to `searchPayloadExtension` contributors when a named domain event triggers the re-index. A `skipApplyErrors` rebuild option passed for a multi-stream projection is now logged as ignored instead of dropped silently. The irreversible-operation gate error for stream entry handlers says that streams cannot declare an agent risk (streams always resolve `mid`, so a hard delete or `forget` inside a stream is denied; dispatch a risk `high` write handler directly). The `migrate-open-to-all` codemod skips symlinks and `dist`/`build`/`.next`/`.git`, and the `unprocessable-error-details-reason` codemod follows namespace imports and reports member-access callees it cannot resolve.

<!-- kumiko-changes
feature: framework
type: fix
title: search extensions never see sensitive row fields on named events, streams cannot hard-delete (gate message now says so), codemod walkers and namespace imports hardened
-->
