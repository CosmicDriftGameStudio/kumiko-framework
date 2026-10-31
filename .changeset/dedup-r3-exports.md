---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

The framework exports a tenant search sweep and an LRU cache, tenant-lifecycle exports the archive-then-delete helper, and auth-email-password/web gains a login-path redirect hook and a topbar option without UserMenu.

<!-- kumiko-changes
feature: framework
type: improvement
title: Search sweep helpers in framework/search
detail: @cosmicdrift/kumiko-framework/search exports collectSearchableFieldNames, isEntitySearchable and reindexTenantsSearch(db, registry, adapter, { tenantIds, timeoutMs?, configureTimeoutMs?, dryRun?, warn? }). The sweep configures each given tenant index, then reindexes every searchable entity for those tenants (system-stream entities once under the system tenant) and returns counts of indexed rows and failures. A failed configure or reindex is reported through warn and does not stop the sweep. Apps no longer need their own configure-on-boot seed: the server's default search config is applied lazily to a missing or factory-default index.
-->

<!-- kumiko-changes
feature: framework
type: improvement
title: createLruCache in framework utils
detail: @cosmicdrift/kumiko-framework/utils exports createLruCache({ maxEntries, ttlMs?, now?, maxTotalSize?, sizeOf? }) with get, set, delete, clear and size. The tenant timezone cache and the managed-pages body cache use it. runWithTimeout moves to the utils module; the api barrel export stays.
-->

<!-- kumiko-changes
feature: tenant-lifecycle
type: improvement
title: archiveAndDeleteTenantRows for tenant-destroy hooks
detail: @cosmicdrift/kumiko-bundled-features/tenant-lifecycle exports archiveAndDeleteTenantRows(ctx, table, aggregateType, escapeHatchReason), which archives each row's event stream and then deletes the tenant's rows, plus the TENANT_DESTROY_ARCHIVED_BY and TENANT_DESTROY_ARCHIVE_REASON constants. inbound-mail-foundation uses the helper, billing-foundation the constants.
-->

<!-- kumiko-changes
feature: auth-email-password
type: improvement
title: Login-path redirect hook and topbar without UserMenu
detail: auth-email-password/web exports useRedirectAuthedFromLogin({ loginPath, target }), which replaces the URL with target while a signed-in user sits on the login path, also after Browser-Back, and isAuthedOnLoginPath. DefaultTopbarActions takes userMenu (default true) to hide the UserMenu and themeToggleTestId for the ThemeToggle button.
-->
