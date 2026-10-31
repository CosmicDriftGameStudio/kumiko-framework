---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-locale-de": minor
"@cosmicdrift/kumiko-locale-es": minor
"@cosmicdrift/kumiko-locale-fr": minor
"@cosmicdrift/kumiko-locale-it": minor
"@cosmicdrift/kumiko-document-designer": patch
"create-kumiko-app": patch
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-types": minor
---

The contact feature keeps its writes (reply, mark-done, send-test, forward-request, submit, report) away from the AI agent; the agent only reads requests, replies and delivery status.

New bundled feature `contact`: a public contact form backend with spam protection, SystemAdmin replies and optional Telegram forwarding.

<!-- kumiko-changes
feature: contact
type: improvement
title: New bundled feature contact: public contact form with spam protection, admin replies and Telegram forwarding
detail: `createContactFeature({ appName, telegram? })` adds a public contact form backend: the anonymous `contact:write:submit` stores a question, contact request or problem report (honeypot, single-use proof-of-work challenge from `contact:query:challenge`, minimum submit time, per-IP and per-email rate limits; spam gets the same 200 body and nothing is stored), notifies every SystemAdmin by mail and, with option `telegram: true` (default off), in a Telegram chat (adds `channel-telegram` to `requires`, the `telegramChat` config key and `contact:write:send-test`). The notification carries no personal data on any channel: only the kind, the app name and a link into the inbox, never name, address, phone, subject or message, because mail and Telegram cannot be shredded. A website sender gets a fixed acknowledgement that repeats nothing they typed (the form is no mail relay); a signed-in admin report gets a copy. The per-email limit counts only submits that passed the spam checks, `contact:write:report` is limited to 10 per hour and user, and the stored `page` loses its query string and fragment. Phone is off by default (`fields.phone`). Logged-in users file reports with `contact:write:report`; SystemAdmins answer with `contact:write:reply` (mail with Reply-To, optional in-app notice for logged-in reporters), mark requests done, and read `contact:query:request-detail`, `contact:query:replies` and `contact:query:request-delivery` (one row per channel with recipient, time and status email|telegram|reply-email|reply-in-app: pending|delivered|failed|skipped|read). Open means no answer yet: only status `open` counts. The browser client is served at `GET /contact/client.js` (`window.KumikoContact`). Requests are crypto-shredding-ready PII with EXT_USER_DATA export and erasure and a 365 day retention. The feature requires `config`, `delivery`, `user-data-rights` and `files` (a file provider must be mounted).
migration: Run `kumiko schema generate`: it adds the `contact-request` and `contact-reply` tables. Apps mounting contact also need the delivery and channel-in-app migrations (`idempotency_key` columns) and a mounted file provider.
-->

<!-- kumiko-changes
feature: renderer
type: improvement
title: Read-only email and phone text fields render as mailto and tel links
detail: A read-only text field with `format: "email"` renders its value as a `mailto:` link and `format: "phone"` as a `tel:` link through the Link primitive. The `tel:` href keeps digits and a leading `+` only; empty values and phone values without a digit stay plain text. `isSafeHref` now also accepts `tel:`, which the Link primitive and the markdown renderer share.
-->

<!-- kumiko-changes
feature: secrets
type: improvement
title: configEdit screens with scope system may map secretKeys
detail: `secrets:write:set`, `secrets:write:delete` and `secrets:query:list` accept `scope: "system"`. The target is always the system tenant, chosen on the server, and only a SystemAdmin may use it (everyone else gets 403). The configEdit body sends the scope for system-scope screens; the boot validator now only rejects secretKeys on user-scope screens. The secrets access rule must include `SystemAdmin` for such a screen to work, for example `createSecretsFeature({ roles: ["TenantAdmin", "SystemAdmin"] })`. Values never go to the client.
-->

<!-- kumiko-changes
feature: renderer
type: improvement
title: configEdit actions: handler buttons between the form fields
detail: `ConfigEditScreenDefinition.actions` takes `{ id, handler, label, description?, buttonLabel, afterField, successMessage? }`. The button renders as its own row directly after `afterField`, calls the write handler with `{}` and never saves the form; it is disabled with the hint `kumiko.configEdit.action.saveFirst` (de, en, es, fr, it) while the form has unsaved changes. Success and failure go through the action notifier, with a banner as fallback. The boot validator checks that the handler is a registered write handler, that `afterField` is a layout field and that ids are unique.
-->

<!-- kumiko-changes
feature: channel-in-app
type: improvement
title: In-app read state by idempotency key
detail: Channels receive the notify `idempotencyKey` as `ChannelContext.idempotencyKey`. The in-app channel stores it in the new nullable column `in_app_messages.idempotency_key` (indexed) and the SystemAdmin query `channel-in-app:query:readStateByKeys` (`{ keys }`, 1 to 50) returns `{ key, readAt }` rows without any content, tenant-scoped. Queued delivery jobs carry the key as `notifyIdempotencyKey` in their payload.
migration: Run `kumiko schema generate`: it adds the `idempotency_key` column and its index to `in_app_messages`. Notes sent before the migration have no key.
-->

<!-- kumiko-changes
feature: delivery
type: improvement
title: Delivery attempts remember the notify idempotencyKey; new attempts-by-keys query
detail: `store_delivery_attempts` gets a nullable text column `idempotency_key` plus the non-unique index `(tenant_id, idempotency_key)`. Every attempt a `ctx.notify` call logs carries the call's `idempotencyKey` (the first event of an attempt stores it; later sent/failed events keep the row's value). The new SystemAdmin query `delivery:query:attempts-by-keys` (`{ keys: string[] }`, 1 to 50) returns channel, status, error code, time and recipient id of those attempts across tenants, never an address. Attempts logged before this version keep `idempotency_key = null`.
migration: Run `kumiko schema generate`. It adds the nullable column `idempotency_key` to `store_delivery_attempts` and the index `store_delivery_attempts_tenant_id_idempotency_key_idx`. No backfill is needed; do not write the column with SQL. Every app that mounts delivery needs this migration when it bumps.
-->

<!-- kumiko-changes
feature: renderer
type: improvement
title: projectionDetail: formatted header subtitle parts and email/phone fields
detail: A `header.subtitle` part `{ field, format }` formats the value with a `FormatSpec` before it is shown. A projectionDetail layout field `{ field, format: "email" | "phone" }` renders its read-only value as a `mailto:` or `tel:` link, like an entity text field with that format.
-->

<!-- kumiko-changes
feature: renderer
type: improvement
title: actionForm summary box on screen forms; detail subtitle and notes use the active locale
detail: An actionForm screen with `summary` now renders the context box under the title also when it is a full screen, not only in a drawer. Header subtitle parts with a `format` and the notes section format dates with the active locale (`formatWhen(value, locale?)`; without a locale the old default stays).
-->

<!-- kumiko-changes
feature: admin-shell
type: improvement
title: createAdminShellFeature extraPlatformPanels
detail: `createAdminShellFeature({ extraPlatformPanels })` appends dashboard panels to the platform "Overview" dashboard, so a feature can put a tile (for example the open contact requests) there instead of mounting a dashboard of its own.
-->

<!-- kumiko-changes
feature: contact
type: improvement
title: contact option reportCancelTarget
detail: `createContactFeature({ reportCancelTarget })` sets the screen the Cancel button of the report form navigates to; without it the form shows no Cancel button.
-->

<!-- kumiko-changes
feature: contact
type: improvement
title: contact option detailLinks; every signed-in user may report a problem
detail: `createContactFeature({ detailLinks: { user, tenant } })` sets the screens the sender and tenant links in the request detail header open (short id or `<feature>:screen:<id>`); defaults stay `user-edit` and `tenant-edit`, `false` removes a link. `contact:write:report` and the report screen are now open to every signed-in user (`openToAll`), not only TenantAdmin and Member. The detail layout drops the phone row while `fields.phone` is off and hides it for an empty value, and the contact feature now requires `notes-history` (the detail notes section needs it).
-->

<!-- kumiko-changes
feature: contact
type: fix
title: The contact website client sends without credentials
detail: `GET /contact/client.js` now sends the challenge and submit requests with `credentials: "omit"`, so a visitor who is signed in on the same domain with any role (including app roles) still submits as an anonymous caller instead of getting 403. Name and email come from the form, never from the session.
-->

<!-- kumiko-changes
feature: framework
type: fix
title: Fully qualified screen targets of another feature boot in navigate actions
detail: The boot validator no longer prefixes the owning feature to a navigate target that is already a `<feature>:screen:<id>` name (entityList toolbarActions, row actions, metric and detail links). Before, such a target failed boot with a doubled name like `contact:screen:publicstatus:screen:x`. Unknown qualified targets are still rejected, and a `tab` is checked against the target screen in the other feature. The renderer resolves such qualified targets like short ids: the link or action is offered when the target screen exists and is accessible, and the URL carries the short screen id.
-->

<!-- kumiko-changes
feature: renderer
type: improvement
title: "On this page" navigation lists related-list and extension sections
detail: The section navigation next to a screen form (entityEdit, projectionDetail) now also lists titled `relatedList` and `extension` sections, not only field sections, and scrolls to them. A section whose title equals the screen title is still left out.
-->

<!-- kumiko-changes
feature: renderer
type: improvement
title: Stored write-only secrets show a masked "set" row with Replace
detail: A write-only field whose value is set (secrets, `writeOnly` entity fields) now renders "•••••••••• set" and a Replace button instead of the empty input. Replace reveals the input (with Remove stored value and the keep-placeholder); after a save the masked row returns. New translation keys `kumiko.field.writeOnly.maskedSet` and `kumiko.field.writeOnly.replace` (de, en, es, fr, it).
-->

<!-- kumiko-changes
feature: framework
type: improvement
title: SystemAdmin may read files of the system tenant from any tenant session
detail: `GET /files/:id`, `/files/:id/meta` and `/files/:id/download-url` also serve a file owned by SYSTEM_TENANT_ID when the caller has the SystemAdmin role, whatever tenant the session is in; the storage provider is resolved for the file's tenant. The file access guard still decides. Delete, variants and upload stay tenant-equal and files of other tenants stay unreadable.
-->

<!-- kumiko-changes
feature: renderer
type: improvement
title: Saved secrets leave the form state; email and phone links are underlined; lists format times in the active locale
detail: After a successful configEdit or secrets save, a typed write-only value is replaced by the "set" marker instead of staying as plaintext in the form state. Read-only email and phone values render as underlined links. The delivery time column and the document-designer overview, version list and overrides drawer format times with the active locale.
-->

<!-- kumiko-changes
feature: locale-de
type: improvement
title: German strings for the contact feature and the configEdit action rows
detail: Adds the German copy for the contact feature (screens, panels, fields, delivery status and notification labels), the configEdit action hint `kumiko.configEdit.action.saveFirst` and the masked write-only secret row (`kumiko.field.writeOnly.maskedSet`, `kumiko.field.writeOnly.replace`). Apps that mount contact and this locale package need no further translation work.
-->

<!-- kumiko-changes
feature: locale-es
type: improvement
title: Spanish strings for the contact feature and the configEdit action rows
detail: Adds the Spanish copy for the contact feature (screens, panels, fields, delivery status and notification labels), the configEdit action hint `kumiko.configEdit.action.saveFirst` and the masked write-only secret row (`kumiko.field.writeOnly.maskedSet`, `kumiko.field.writeOnly.replace`). Apps that mount contact and this locale package need no further translation work.
-->

<!-- kumiko-changes
feature: locale-fr
type: improvement
title: French strings for the contact feature and the configEdit action rows
detail: Adds the French copy for the contact feature (screens, panels, fields, delivery status and notification labels), the configEdit action hint `kumiko.configEdit.action.saveFirst` and the masked write-only secret row (`kumiko.field.writeOnly.maskedSet`, `kumiko.field.writeOnly.replace`). Apps that mount contact and this locale package need no further translation work.
-->

<!-- kumiko-changes
feature: locale-it
type: improvement
title: Italian strings for the contact feature and the configEdit action rows
detail: Adds the Italian copy for the contact feature (screens, panels, fields, delivery status and notification labels), the configEdit action hint `kumiko.configEdit.action.saveFirst` and the masked write-only secret row (`kumiko.field.writeOnly.maskedSet`, `kumiko.field.writeOnly.replace`). Apps that mount contact and this locale package need no further translation work.
-->

<!-- kumiko-changes
feature: document-designer
type: improvement
title: Template dates use the active app locale
detail: The modified-at dates in the template list, the origin bar, the version list and the overrides drawer are formatted with the active app locale instead of the browser default.
-->

<!-- kumiko-changes
feature: create-kumiko-app
type: improvement
title: Feature manifest lists contact and its new options
detail: `feature-manifest.json` describes the bundled feature `contact` with its config keys and dependencies (`config`, `delivery`, `user-data-rights`, `files`; `channel-telegram` with option `telegram`), so scaffolding and `kumiko check` know it.
-->
