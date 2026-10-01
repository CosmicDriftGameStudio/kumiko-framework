---
title: Migration Guide
description: Breaking changes and migration hints for Kumiko upgrades
status: reference
verified: 2026-10-01
---

# Migration Guide

This document lists breaking changes across all bundled features.
Use `kumiko upgrade` to check what's new since your current version.

## 0.330.0

### admin-shell

**admin-shell requires the metrics and metrics-system features and builds its overview dashboards from a metrics list**

Dashboard panels gain the chart kinds `stacked-bars`, `segment-bars` and `stacked-area`, a subtitle, per-series tones, static query `params`, `ignoreScreenFilter`, an empty label and hint, a `span` (half/full width), a stat `sparklineField` and static `tone`, a `negative` tone, an unlabelled `stat-group` KPI strip and bar/badge list columns. Every panel shows skeleton, empty and error states with retry. A screen can declare a `timeRange` control and a `scope` badge and notice. The admin-shell overview screens use all of this and show the metrics of the new `metrics` and `metrics-system` features. `deliveries-by-channel` now labels the email, in-app and push channels.

**Migration:** Mount createMetricsFeature({ metrics: DEFAULT_METRICS }) and createSystemMetricsFeature({ metrics: DEFAULT_METRICS }) from the metrics bundled feature before admin-shell. DEFAULT_METRICS also requires the delivery, sessions, jobs and tenant features.

If you do not mount all of them, pass the same reduced list to all three: createMetricsFeature({ metrics }), createSystemMetricsFeature({ metrics }) and createAdminShellFeature({ metrics }). Overview panels exist only for metric ids in that list.

### enterprise:locale-de

**locale-de and locale-es drop 110 keys that no framework feature registers any more (old custom-screen keys such as audit.log.*, jobs.runs.*, userDataRights.privacyCenter.title)**

The new i18n-parity test in `use-all-bundled` harvests the English copy from the real registrations (feature translations, client plugins, renderer defaults, mail templates) and fails with `key -> locale` when `locale-de` or `locale-es` lacks a key or an en-catalog drifts. This added the missing German and Spanish copy for billing plans, the privacy-center status field and many more keys, and removed 110 translation keys no feature registers any more. German uses "Ereignisprotokoll" for the audit log everywhere. `userDataRights.privacyCenter.restriction.dialogTitle` and `.deletion.dialogTitle` are registered in English by the feature.

**Migration:** The framework no longer renders these keys, so framework screens are unaffected. If app code or an app test calls t() with one of them, register that key in the app's own translations or switch to the key the framework screen uses now (for example the screen title key screen:<screen-id>.title, as in screen:audit-log.title).

### enterprise:locale-es

**locale-es drops the same keys that no framework feature registers any more**

The new i18n-parity test in `use-all-bundled` harvests the English copy from the real registrations (feature translations, client plugins, renderer defaults, mail templates) and fails with `key -> locale` when `locale-de` or `locale-es` lacks a key or an en-catalog drifts. This added the missing German and Spanish copy for billing plans, the privacy-center status field and many more keys, and removed 110 translation keys no feature registers any more. German uses "Ereignisprotokoll" for the audit log everywhere. `userDataRights.privacyCenter.restriction.dialogTitle` and `.deletion.dialogTitle` are registered in English by the feature.

**Migration:** Same as locale-de: register any removed key your app still calls in the app's own translations, or switch to the key the framework screen uses now.

### enterprise:renderer-web

**Dashboard screens show screen.description only when it is an i18n key; plain-text descriptions stay agent-facing and are no longer rendered**

Dashboard panels gain the chart kinds `stacked-bars`, `segment-bars` and `stacked-area`, a subtitle, per-series tones, static query `params`, `ignoreScreenFilter`, an empty label and hint, a `span` (half/full width), a stat `sparklineField` and static `tone`, a `negative` tone, an unlabelled `stat-group` KPI strip and bar/badge list columns. Every panel shows skeleton, empty and error states with retry. A screen can declare a `timeRange` control and a `scope` badge and notice. The admin-shell overview screens use all of this and show the metrics of the new `metrics` and `metrics-system` features. `deliveries-by-channel` now labels the email, in-app and push channels.

**Migration:** To keep a visible subtitle under a dashboard title, set screen.description to an i18n key (for example "my-feature:screen.overview.description") and register its translations.

## 0.328.0

### enterprise:headless

**Dates format with two-digit day and month**

`formatValue` for date values passes `day: "2-digit"` and `month: "2-digit"`, so German output is 01.10.2026 instead of 1.10.2026 in lists, details and related lists. List view models carry `hideOnNarrow` onto columns.

**Migration:** Update tests and snapshots that expect single-digit day or month.

### enterprise:renderer

**Screens fill the shell height by default**

entityList, projectionList, projectionDetail, entityEdit, actionForm and wizard screens now fill the height of the shell content. The table or the form body scrolls inside, the toolbar stays on top and the pager or action bar stays pinned at the bottom (`scrollBody`, `stickyActions`). The shell header is 56px. Custom screens and direct DataTable or Form usage are unchanged.

**Migration:** Set `fillHeight: false` on a screen to restore the old page scrolling (table grows with its rows, pager below the last row, form footer in the flow). Apps with e2e or screenshot tests that scroll the page to reach the pager or the form footer need to adjust them or opt out per screen.

**Pager shows a status line, page size select and Page X of Y instead of page numbers**

The numbered page list is gone. The list footer shows "1-19 of 19 <entities>" (with the entity plural label when known), "Page X of Y", previous and next buttons and a page size select (25, 50, 100). Lists without a pager show a plain entry count. The chosen size is kept in the URL under `<screen>.size`.

**Migration:** Remove code and tests that click numbered page buttons (`-page-N` test ids); use the next and previous buttons. The screen's declared `pageSize` stays the default, `<screen>.size` in the URL overrides it. The new keys `kumiko.pager.pageOf`, `kumiko.pager.status.noun`, `kumiko.pager.pageSize`, `kumiko.pager.pageSizeLabel`, `kumiko.list.count.*` exist in en, de and es; apps with their own locale need them too.

**rowActionMode adaptive has new semantics and mobile rows lose the kebab for plain navigation**

With `rowActionMode: "adaptive"` (the default), a table with `onRowClick` renders the first cell as a keyboard-operable link and puts all row actions into the kebab. Without `onRowClick` the primary row action is a link-button and the remaining actions go into the kebab (a single action gets no kebab). Below the md breakpoint a row that only navigates shows a chevron and no kebab.

**Migration:** Code or tests that expect up to two inline row action buttons must open the kebab or use `rowActionMode: "inline"`, which is unchanged. To keep a visible action next to the row link, drop `onRowClick` and declare the action as the primary row action.

**Form, wizard and detail screens use the board layout**

Screen forms have no card, sections are separated by lines, fields flow in rows with widths by type (text 240px, number 96px, money 160px, date and select 200px, textarea full row) and the page title lives in the shell header. Delete and Copy link move into the header kebab, the footer reads status, Cancel, Save, and the wizard footer has no Cancel. Wizard steps sit in a vertical rail from the lg breakpoint. The first detail header action is a button, further ones sit in the kebab. Detail screens have no header card and use the full width: metrics render as a dl band, tabs are underlined only when active, related lists are full-bleed with a count footer. Required-field asterisks are omitted when every field is required and "All fields are required." is shown instead.

**Migration:** Adjust screenshots and DOM tests that pin the old card layout. `fillHeight: false` restores page scrolling only; the footer order, the moved actions and the new field layout apply in both modes. Empty list cells render a dash.

### enterprise:renderer-web

**IBM Plex replaces Inter as the default typeface**

renderer-web ships IBM Plex Sans (400, 500, 600) and IBM Plex Mono (400, 500) as self-hosted woff2 files under the SIL Open Font License. `--font-sans` and `--font-mono` default to Plex. Inter is no longer wired in.

**Migration:** Apps that expect Inter set `--font-sans` (and load the font themselves) in their styles.css or through the theme plugin. Nothing else is needed for apps happy with Plex. Custom server setups that do not use the dev server or the prod build of server-runtime must serve `/assets/kumiko/fonts/*.woff2` from the renderer-web `fonts` folder with the MIME type `font/woff2`, and `font-src 'self'` covers it.

**Warm-neutral design tokens, 6px radius, content on the surface color**

Light and dark themes were rebuilt. Light: surface #FFFFFF, page #F3F2EE, sunken #F6F5F1, line #E2E0D9, strong line #CFCCC3, row line #ECEAE4, control border #908D85, text #1A1C1E, text 2 #474B50, text 3 #5F6368, disabled #8A8E93. New tokens: `--color-foreground-secondary`, `--color-foreground-disabled`, `--color-border-strong`, `--color-border-row`, `--color-status-*-surface` (ok, warn, bad, critical), `--color-status-neutral` and `--color-status-neutral-surface`, `--color-sidebar-muted`, `--color-sidebar-input`. `--radius` is 0.5rem so controls use 6px. The shell content, header and toolbars sit on the card surface, the sidebar (232px wide) takes the page color. Buttons: the secondary variant is a surface with a border, a ghost variant was added. Controls are 36px high (32px small), at least 44px below md.

**Migration:** Apps that override tokens keep working, but check contrast pairs for the new roles and add overrides for the new tokens if the brand needs them. Apps with hard-coded colors that relied on the page color behind content, on grey secondary buttons or on the 10px radius must adjust. Screenshot tests need new baselines.

**Field presentation follows option count, label length and type**

A select without an explicit `display` renders as a segmented control for up to 3 options with labels of at most 16 characters, as a vertical radio list for up to 3 longer options and as a dropdown for 4 or more. MoneyInput has no stepper, right-aligns its value and shows the currency as a suffix. Number inputs are left-aligned. Fields get a control width by type (number 96px, money 160px, date 200px, select at least 200px, text 240px), labels never wrap, radio lists and textareas take their own row.

**Migration:** Set `display: "radio"` or `display: "dropdown"` on the select field to pin a presentation. Selects with 4 options no longer render as radio groups by default. Tests that spin a money value with the stepper buttons must type the value instead.

**Drawer widget defaults to the flush variant, Link with target _blank sets rel**

The `Drawer` widget renders flush against the right edge with full height, no margin, no radius and a strong left border unless `variant="floating"` is passed. Every `<Drawer>` without `variant` changes its look. `Link` now forwards `rel` and `target`; with `target="_blank"` the default `rel` is `noopener noreferrer`.

**Migration:** Pass `variant="floating"` to keep the detached panel look. Tests that assert a missing `rel` on `target="_blank"` links need updating.

**Money field shows the currency symbol as a suffix inside the field, date field has its calendar button inside the input**

MoneyInput renders the value right-aligned with the currency symbol as a separate muted adornment (`<id>-currency`), placed before the number for locales that put it there. The input text no longer contains the symbol ("1.234,56", not "1.234,56 €"); parsing and the stored minor-unit value are unchanged. DateField and TimestampInput draw the calendar button as an icon inside the right edge of the input instead of a separate square button; the button keeps its aria-label and keyboard operation.

**Migration:** Tests that read the money input value and expect the symbol must read the `<id>-currency` element or drop the symbol from the expected text. Selectors that find the calendar button by role and label keep working.

## 0.327.0

### step-dispatcher

**step.dispatch-requested payloads are flat and crypto-shredded; kumiko:system:* events have a declared PII stance**

**Migration:** No code change is needed for r.step.mail.send / r.step.webhook.send callers. The step.dispatch-requested payload changed from a nested `spec` object to flat fields (mail.send: to as JSON string, subject, body, from; webhook.send: url, method, headersJson, bodyJson, auth, retry). With a subject KMS configured, those fields are encrypted under a per-dispatch record key (record:step-dispatch:<aggregateId>) that the step-dispatcher erases once the outcome is recorded (Art. 17 via crypto-shredding). There is no legacy branch: a dispatch-requested event still in flight at upgrade (old nested shape) ends as step.dispatch-failed with error "invalid dispatch payload", so drain the queue before deploying or accept the one-time failed event. Webhook delivery errors no longer echo the URL or the raw request error. mail.send delivery errors are recorded as a generic "mail delivery failed"; the adapter's raw error goes to the step-dispatcher log. Code reading dispatch-requested payloads directly must switch to the flat shape. A new kumiko:system:* event type must be added to SYSTEM_EVENT_PII_STANCES (crypto/system-event-pii.ts); encryptEventPayloadPii throws for an undeclared system type. SYSTEM_EVENT_PREFIX and AGGREGATE_TRANSFERRED_EVENT_TYPE now live in crypto/system-event-pii.ts, and the STEP_DISPATCH_* constants are exported from @cosmicdrift/kumiko-framework/engine instead of engine/steps/webhook-send.

### workflow-runner

**Workflow run-failed and retry.scheduled events store a generic error text instead of the raw error**

**Migration:** The `error` field of workflow.run-failed and workflow.retry.scheduled events is now generic, "workflow step failed (<error class>)" (or "(unknown error)" for non-Error throwables), because the raw text can contain recipients or payload fragments and would survive an erase. The raw error goes to the log (namespace workflow-runner, and the framework logger for retry). Code that parses the `error` text must switch to `reason` (machine-readable, set for definition changes) or to the logs. Already stored events keep their old text. The texts for an unregistered workflow and a definition-fingerprint mismatch are unchanged. describeWorkflowStepError is exported from @cosmicdrift/kumiko-framework/engine.

## 0.326.0

### config

**Extension-selector settings render as one tenant screen**

BREAKING: an extension-selector key now renders as a select of the mounted plugin ids, and
`config:write:set` rejects every value except a mounted plugin id or "" with 422
`config.errors.unknownExtensionPlugin`.

The owner's tenant screen `<owner>-tenant` is now a dashboard; its former configEdit moved
to `<owner>-tenant-selection`. Plugin features under a masked selector lose their tenant nav
entry: their `<plugin>-tenant` screen stays as a nav-less embedded panel (a direct deep link
still resolves), and their secrets move from the global `secrets` screen into
`<plugin>-tenant-secrets` panels. A plugin feature registered under more than one selector
registration keeps the previous behaviour.

Generated hub screens need the new key `config.settings.extensionSelectorHint` (shipped in
the config and secrets bundles, en/de/es).

**Migration:** Links, tests or screenshots that open `<plugin>-tenant` through the nav or expect a configEdit
at `<owner>-tenant` should open `<owner>-tenant` (now the dashboard) and look for the plugin
panels there. Tenant rows or scripts that write a selector value naming no mounted plugin must
write a mounted plugin id or "" instead. No new translation keys are required from apps.

## 0.324.0

### framework-core

**Writes on readAsInstruction fields now require agent.risk "high" on the directly-dispatched handler**

**Migration:** New field flag `readAsInstruction: true` on `text`, `longText`, and `jsonb`
fields (`@cosmicdrift/kumiko-types`) marks a field whose value a later run
reads as an instruction — a prompt, rule, or template. Any create/update
whose payload writes such a field must resolve `agent.risk: "high"` on the
directly-dispatched entry handler, or the executor gate denies it with
`access_denied` / `instruction_field_write_requires_high_risk` before any
DB write. This is opt-in per field, but touches every write path once a
field carries the flag — consumer checklist:

1. Mark fields that a later run reads as an instruction (prompts, rules,
   templates) with `readAsInstruction: true`.
2. Update your own handlers that write such a field via
   `executor.create`/`executor.update`, or delegate into one via
   `ctx.write`/`writeAs`, to `agent: { risk: "high" }` — the directly
   called handler must carry it, delegation does not inherit it.
3. Standard entity-convention create/update handlers on an entity with such
   a field now default to "high" automatically; declaring a lower
   `agent.risk` on one is a define-time error, same as the delete floor
   from #3345.
4. An update whose payload doesn't include the flagged field stays allowed
   unchanged — the gate checks payload presence after `preSave`, not
   whether the value actually changed.
5. Not gated: `delete`/`restore` (they don't write the field; the existing
   irreversible-delete floor still applies), and your own domain events
   applied via `ctx.appendEvent` whose projection writes a flagged field —
   route such writes through the executor primitives (`create`/`update`)
   to get the gate.
6. On `create`, a flagged field with a `default` counts as written even if
   the payload omits it — `applyDefaults` runs before the gate. A custom
   mid-risk create handler whose payload leaves the field out is denied
   just the same, and a standard create with `excludeFields` on such a
   field still resolves to "high".

## 0.323.0

### enterprise:dev-server

**kumiko-build reads client entries from package.json "kumiko.clientEntries"/"kumiko.clientEntry" instead of inferring them from filenames**

`kumiko-build` (and the `kumiko build` command) now call
`readClientEntriesConfig(cwd)` and pass the result into
`buildProdBundle`, instead of relying on `discoverClientEntries`'
filename-based multi-entry discovery. `@cosmicdrift/kumiko-dev-server/build`
re-exports `resolveClientEntries`, `readClientEntriesConfig`, and
`ClientEntryDeclaration` in place of `discoverClientEntries`.

**Migration:** See the `@cosmicdrift/kumiko-server-runtime` changelog entry above for
the required package.json changes — the dev-server change is the CLI
wiring for the same underlying behavior.

### enterprise:server-runtime

**buildProdBundle takes client entries explicitly via package.json "kumiko.clientEntries"/"kumiko.clientEntry" — no more filename inference**

`discoverClientEntries(cwd)`, which scanned `src/` for
`client-<suffix>.tsx` files and treated every match as its own bundle
entry, is replaced by `resolveClientEntries(cwd, declared)` plus
`readClientEntriesConfig(cwd)`, a boundary parser for package.json
`kumiko.clientEntry` / `kumiko.clientEntries`. `buildProdBundle(options)`
now accepts the same `clientEntry`/`clientEntries` shape directly.

`kumiko.clientEntries` entries are validated: `name` must match
`^[a-z][a-z0-9-]*$` (it becomes the output filename), `sourceFile` (and
`htmlPath`, if set) must resolve inside the app root, `sourceFile` must
exist, and names/html-output-files/source-basenames must be unique
across the list. `clientEntry` and `clientEntries` are mutually
exclusive; an empty `clientEntries` array is rejected (omit the key
instead). Apps with only `src/client.tsx` or `src/client.ts` need no
declaration — that convention is unchanged.

**Migration:** Apps with `src/client-<name>.tsx` entries: add the entry list to
package.json, using the same objects already passed to
`runDevApp`/`createKumikoServer`'s `clientEntries` (paths relative to the
app root). Without this, the build now throws instead of silently
building without those bundles.

  publicstatus:

    "kumiko": {
      "clientEntries": [
        { "name": "public", "sourceFile": "./src/client-public.tsx" },
        { "name": "admin", "sourceFile": "./src/client-admin.tsx", "htmlPath": "./public/admin.html" },
        { "name": "auth", "sourceFile": "./src/client-auth.tsx", "htmlPath": "./public/auth.html" }
      ]
    }

  show-pony:

    "kumiko": {
      "clientEntries": [
        { "name": "admin", "sourceFile": "./src/client-admin.tsx", "htmlPath": "./public/admin.html" },
        { "name": "public", "sourceFile": "./src/client-public.tsx", "htmlPath": "./public/index.html" }
      ]
    }

  offlot-app:

    "kumiko": {
      "clientEntries": [
        { "name": "app", "sourceFile": "./src/client-app.tsx", "htmlPath": "./public/app.html" }
      ]
    }

Apps using a single entry that isn't `src/client.tsx`: add
`"kumiko": { "clientEntry": "./src/…" }` instead.

Apps with only `src/client.tsx` | `src/client.ts`: no action needed.

`discoverClientEntries` (exported from
`@cosmicdrift/kumiko-dev-server/build`) is removed; callers use
`resolveClientEntries(cwd, readClientEntriesConfig(cwd))`.

### framework-core

**createTextField/createLongTextField require an explicit personal-data stance**

Both factories' `overrides` parameter is no longer optional and must
include a `personal` stance:
`{ personal: "self", find: "exact" | "fuzzy" | "none" | "secret" }`
(longText: `find: "none" | "secret"`), `{ personal: "tenant", find: … }`,
`{ personal: { of: "<ownerField>" }, find: … }`, `{ personal: "ref" }`, or
`{ personal: false, reason: "<why this is not personal data>" }`. A
missing/malformed shape throws at the call site (`createTextField(...)` /
`createLongTextField(...)` in the message, with every valid option
listed) instead of silently resolving to an unannotated field — this
also removes the #2918 boot-time deprecation warning, since the shape it
warned about can no longer be constructed.

**Migration:** Two call forms now throw: `createTextField()` / `createLongTextField()`
with no argument at all, and an options object with no `personal` key,
e.g. `createTextField({ required: true })`. Add a stance to every call:

  createTextField({ personal: "self", find: "exact" })
  createTextField({ personal: "tenant", find: "none" })
  createTextField({ personal: { of: "authorId" }, find: "none" })
  createTextField({ personal: "ref" })
  createTextField({ personal: false, reason: "is_business_data" })

`personal: false` additionally requires a non-empty `reason` string.
`find` is mandatory whenever `personal` names a subject (`"self"` /
`"tenant"` / `{ of }`) — not for `"ref"` or `false`. The #2918 boot-time
deprecation warning for this shape is gone; there's nothing left for it
to warn about.

To find remaining call sites (the #2919 codemod mode below is the
migration tool): `kumiko-guards guards
--guard="Text-Field Personal-Stance Guard"` flags every
statically-decidable call missing a stance. `bun
node_modules/@cosmicdrift/kumiko-framework/src/scripts/codemod/pii-personal-migration.ts
<targetDir> --report-stance` classifies unannotated text/longText fields
by name heuristic (direct/user-owned/user-reference/near-miss/
unclassified) to help pick the right stance — it does not add one
automatically, since a wrong guess would be worse than the throw. This
codemod is not wired into `kumiko upgrade --apply`; run it by hand. It
also only transforms fields still carrying the OLD flag-based API
(`pii`/`userOwned`/`tenantOwned`/`subjectRef`/`allowPlaintext`) — a field
with no annotation at all was never in its mapping table and needs a
stance added by hand either way.

## 0.322.0

### framework-core

**Irreversible writes now require agent.risk "high" on the directly-dispatched handler**

**Migration:** Any write handler reachable as the directly-dispatched entry point that
performs `executor.forget()` (any entity) or `executor.delete()` on an
entity without `softDelete` must resolve `agent.risk: "high"`, or the
executor gate now denies it with `access_denied` /
`irreversible_operation_requires_high_risk` before any DB read.

Three breaking changes ship together:
1. Add `agent: { risk: "high" }` to your own write handler if it directly
   runs `forget` or a hard `delete` on a non-softDelete entity.
2. Delegating via `ctx.write`/`ctx.writeAs` from a lower-risk handler into
   a high-risk forget/hard-delete handler no longer inherits the inner
   handler's risk — the outermost/entry handler's declared risk governs,
   so the delegating handler itself must be "high".
3. Declaring `agent.risk` below "high" on a standard entity-convention
   delete handler for a non-softDelete entity is now a define-time/boot
   error instead of a silently-accepted setting.

Standard entity-convention delete handlers on a non-softDelete entity now
default to "high" automatically (no more implicit "always allow").

`dispatchToolCall` treats the invoked tool itself as the entry handler,
not the surrounding turn/approve write handler that dispatched it — a
mid-risk "approve" handler can safely invoke a high-risk tool directly,
but a mid-risk tool that itself delegates to a high-risk handler via
`ctx.write`/`writeAs` is still denied per rule 2.

`runAsDirectCallEntry` (framework `/api`) is the one sanctioned entry
boundary: it clears the entry handler so the next dispatch counts as the
directly called one. `dispatchToolCall` uses it because the human
confirmation happens in approve; do not use it to lift a handler past
the floor.

Remaining gap: `afterCommit` hooks, jobs, and event consumers are not
gated by this floor — they have no directly-dispatched entry handler to
attribute risk to.

## 0.321.0

### billing-foundation

**switch-plan rejects a subscription with a scheduled cancellation**

`billing-foundation:write:switch-plan` now throws a `409 ConflictError`
(`billing-foundation.errors.cancellationScheduled`) when the tenant's
subscription already has `cancelAt` set — switching plans mid-cancellation
previously silently proceeded and could leave the new plan itself
scheduled to cancel. `billing-foundation:query:billing-plans` now resolves every
non-current plan's `action` to `unavailable` (instead of `switch`) while a
cancellation is scheduled, and the billing-plans panel shows a
`switchRequiresReactivation` message alongside the existing
`cancelScheduled` banner.

**Migration:** A tenant that switches plans while their subscription is scheduled to
cancel now gets a 409 instead of a successful switch. Callers driving
`switch-plan` directly (not through the bundled panel) must reactivate the
subscription first (`create-portal-session` / the provider's own
reactivation flow) before retrying the switch.

### delivery

**Unsubscribe route splits into a non-writing GET confirmation page and a writing POST (RFC 8058)**

`createUnsubscribeRoute({ secret })`, which mounted a single `GET` route
that wrote the opt-out as a side effect of the request, is replaced by
`createUnsubscribeRoutes({ secret })`, which returns both routes for the
same path: `GET` renders a confirmation page (`<form method="post">`) and
performs no write; `POST` performs the write, reading the token from a
form-urlencoded body first, then the query string as a fallback (so an
RFC-8058 one-click client that POSTs `token=` only in the URL still works).
Token verification and error mapping (`400 unsubscribe_token_invalid`) are
unchanged and shared between both routes.

**Migration:** Replace `extraRoutes: [createUnsubscribeRoute({ secret })]` with
`extraRoutes: [...createUnsubscribeRoutes({ secret })]`.

Unsubscribe links already mailed out before this upgrade now show a
confirmation page on click instead of unsubscribing immediately — the
recipient must submit the form (or a one-click mail client must POST) to
complete the opt-out. If the app rendered its own confirmation page in
front of the old GET link, it can be removed; the framework route now
covers that step.

### framework-core

**webhook.send step auth secretRef renamed to secret; MultiStreamApplyContext gained an optional secrets field**

`r.step.webhook.send`'s `auth` union renamed `secretRef` → `secret` (see
the step-dispatcher entry for the full rationale). `MultiStreamApplyContext`
(and `createMultiStreamApplyContext`'s deps) gained an optional
`secrets?: SecretsContext` field, mirroring `files`/`derivatives` — present
when the app booted with the secrets feature, letting a saga/process-
manager MSP apply read a tenant secret with its own audit context. The
server's MSP consumer wiring now threads the boot-time `AppContext.secrets`
through automatically; `rebuildMultiStreamProjection`'s rebuild context
deliberately does not carry `secrets` (rebuild must stay side-effect-free).

**Migration:** Rename `auth.secretRef` → `auth.secret` at every `r.step.webhook.send`
call site. No action needed for `MultiStreamApplyContext` consumers that
don't read `ctx.secrets` — the field is optional and additive.

### step-dispatcher

**Webhook auth secrets are now tenant-owned via the secrets feature, not a global env var**

`r.step.webhook.send`'s `auth` config renamed `secretRef` → `secret`. The
value is now a name inside the tenant-owned secrets namespace
`step-dispatcher:webhook-auth.<secret>` (secrets feature), resolved via
`SecretsContext.get()` at dispatch time with an audit read stamped with
the triggering event's userId (or the system actor for cron/resume
dispatches). `setWebhookSecretResolver` / the `WEBHOOK_SECRET_*` env
convention are gone. `performWebhookDispatch(spec)` now takes a required
second `deps: { tenantId, userId, secrets }` argument.

**Migration:** Mount `createSecretsFeature()` (with a `MasterKeyProvider`) alongside
`createStepDispatcherFeature()` — boot-validation now fails without it.
For each tenant that uses `r.step.webhook.send` with `auth`, set the
credential via `secrets:write:set` under
`step-dispatcher:webhook-auth.<secret>` (the same name passed as
`auth.secret`). Rename `auth.secretRef` → `auth.secret` at every
`r.step.webhook.send({ auth: {...} })` call site. Remove any
`WEBHOOK_SECRET_*` env vars — they're no longer read.

A `step.dispatch-requested` event already enqueued before this upgrade
(still carrying the old `secretRef` shape) fails validation on drain and
is recorded as `step.dispatch-failed` with `error: "invalid dispatch
payload"` instead of silently resolving a stale ref — drain the queue (or
accept the one-time failed event) before deploying.

Tests calling `performWebhookDispatch` directly or using
`setWebhookSecretResolver` must pass a `SecretsContext` (or `undefined`)
via the new `deps` argument instead.

## 0.320.0

### enterprise:dev-server

**createKumikoServer/runDevApp gained a trustedProxyHops option**

`CreateKumikoServerOptions`/`RunDevAppOptions` gained a top-level
`trustedProxyHops`, forwarded into `setupTestStack`'s `buildServer` call.
Dev normally runs unproxied, so this is usually left unset (default 0).

**Migration:** No action needed for the default (unproxied) dev setup. Set
`trustedProxyHops` only if you run the dev server behind a reverse proxy.

**Dev-server HTML no longer injects __KUMIKO_SCHEMA__ either**

**Migration:** Same semantics as the prod change: `DevHostDispatchResult.injectSchema`
is deprecated and ignored. The dev-server's auto-mint mode still sets
the `kumiko_auth`/`kumiko_csrf` cookies on the HTML response, so a
client-side fetch to `/api/schema` is authenticated immediately without
a real login round-trip.

### enterprise:server-runtime

**runProdApp threads the Bun socket address and a trustedProxyHops option through to the client-IP resolver**

`buildBunServeOptions` now extracts the client socket address once via
`server.requestIP(req)` at the outermost Bun.serve fetch callback (a
cloned/rebuilt Request loses that ability) and threads it through
`tryHonoFirst`/`withSecurityHeaders`/`buildStaticFallback` as Hono's
`env`. `RunProdAppOptions` gained a top-level `trustedProxyHops` (falls
back to the deprecated `auth.trustedProxyHops`, then
`KUMIKO_TRUSTED_PROXY_HOPS`), forwarded into `buildServer` and the
static-fallback's own client-IP resolver.

**Migration:** Same as the framework entry — set `trustedProxyHops` on `runProdApp` when
deployed behind a reverse-proxy/ingress.

**Static fallback no longer injects __KUMIKO_SCHEMA__ into HTML**

**Migration:** `HostDispatchResult.injectSchema` is deprecated and ignored — HTML never
carries the schema anymore, in prod or dev. `createKumikoApp` now fetches
the schema itself from the authenticated `GET /api/schema` after its
clientFeature gates (e.g. an auth gate) let rendering through, so a
signed-in admin app keeps working without changes. Anything that read
`window.__KUMIKO_SCHEMA__` directly (custom clients, e2e fixtures) must
switch to fetching `/api/schema` instead. An anonymously reachable page
that used to render schema-based screens needs `createPublicSurface`,
which never carries a schema. The `@cosmicdrift/kumiko-server-runtime/inject-schema`
subpath export is removed.

### framework-core

**Centralized client-IP resolver replaces the old first-XFF-entry heuristic**

New `trustedProxyHops` option on `ServerOptions` (default 0 — trusts no
proxy header, only the socket address counts). Precedence:
`options.trustedProxyHops ?? options.auth?.trustedProxyHops ?? 0`.
`requestContext.ip` is now always set for an HTTP request (falls back to
"unknown" instead of being left undefined), so `rateLimit: { per: "ip" }`
handlers reached via `r.httpRoute`/`extraRoutes` systemQuery are never
silently unthrottled. `rate-limit/middleware.ts`'s `globalIpRateLimit`/
`authEndpointRateLimit` and `auth-routes.ts`'s `createAuthRoutes` gained a
`trustedProxyHops`/`clientIpResolver` option and now share the server's
one resolver instance instead of each building their own.

**Migration:** Apps deployed behind a reverse-proxy/ingress that appends to
X-Forwarded-For must set `trustedProxyHops` (buildServer/runProdApp/
runDevApp top-level option) to the number of trusted hops — usually `1`
for a single ingress. Without it, every client collapses into one shared
rate-limit bucket (safe default, but likely too strict for real traffic).
Apps not behind a proxy need no change; `trustedProxyHops` defaults to 0.

Integration tests that call an `ip`/`ip+handler`-rate-limited handler
repeatedly through `stack.http.raw`/`stack.app.request` (no real socket)
now share one "unknown" bucket instead of skipping the bucket entirely —
a previously-passing test suite can start seeing 429s. Fix by flushing
the rate-limit namespace between test cases (`stack.redis.flushNamespace()`
in `beforeEach`), or by setting `setupTestStack({ trustedProxyHops: 1 })`
and sending a distinct `X-Forwarded-For` per test case. Also check any
test that nulls `context.redis` via `extraContext` to exercise a
handler's own redis-down guard: `setupTestStack` now keeps the L3
rate-limit resolver alive from its own always-real Redis in that case
(an explicit `context.rateLimit` still wins), so a handler-declared
`rateLimit` is enforced instead of throwing `InternalError` for a missing
resolver.

**Personal Access Tokens are now scoped to the dispatcher routes only**

**Migration:** A caller using a PAT for SSE, file upload/download, /api/auth/*, a feature
r.httpRoute, or an entry:"user" extraRoute now gets a 403 and needs a
session-cookie or JWT credential for those calls instead. The dispatcher
routes (/api/write, /api/batch, /api/query, /api/command, /api/stream) are
unaffected.

### inbound-provider-imap

**The tenant-configured IMAP host must resolve to a public address**

**Migration:** An operator relying on an internal IMAP server or a local dev/test server
(greenmail on localhost or a private IP) now gets an InboundAuthError
(account marked auth_error) unless that host is explicitly allowed. Set
the same operator env var mail-transport-smtp reads (comma-separated, no
boot-time code call needed) before starting the process:
  KUMIKO_MAIL_ALLOWED_PRIVATE_HOSTS=greenmail.internal
This is an operator env var, not a tenant config value — a tenant cannot
add their own host to this list. A DNS resolution failure for a
genuinely unreachable host now surfaces as InboundTransientError (job
retry) instead of reaching imapflow at all.

### ledger

**Account code is unique per tenant (partial unique index read_ledger_accounts_tenant_id_code_uidx)**

`accountEntity` declares `read_ledger_accounts_tenant_id_code_uidx`, a unique index on `(tenant_id, code)` that only covers accounts with a code. Two parallel find-then-create calls for the same code (two tabs, two devices) could each create an account and leave a tenant with duplicate codes. The second write now fails with `unique_violation` (HTTP 409). This applies to `createAccount` and to an `updateAccount` that changes the code. Accounts without a code are unaffected, and the same code in different tenants stays allowed.

**Migration:** Before you apply the migration, check for existing duplicates:

  SELECT tenant_id, code, count(*) FROM read_ledger_accounts
  WHERE code IS NOT NULL GROUP BY tenant_id, code HAVING count(*) > 1;

`kumiko schema generate` treats a new unique index on a managed projection as destructive. It emits DROP TABLE + CREATE TABLE plus a `.rebuild.json`, which means a full event replay of `read_ledger_accounts`. A rebuild creates the table's indexes before it replays. So if a tenant's event history ever contained two accounts with the same code at the same time, the replay hits the unique index and fails, even after one of them was renamed. For an app with existing ledger data, hand-edit the generated migration before committing it. Replace the DROP/CREATE with an in-place

  CREATE UNIQUE INDEX IF NOT EXISTS "read_ledger_accounts_tenant_id_code_uidx"
    ON "read_ledger_accounts" ("tenant_id", "code") WHERE "code" IS NOT NULL;

and delete the `.rebuild.json`. The migrations snapshot stays as generated. If the duplicate check found rows, resolve them first through real writes, for example an `updateAccount` that gives the extra account another code. Never edit the table directly. For such a tenant, a later full rebuild of `read_ledger_accounts` still replays the historical duplicate and fails. An app that already created this index by hand under the same name (money-horse migration 0024) gets a no-op from the in-place statement.

Code that does find-then-create by code should expect `unique_violation` on create and re-read the account that won the race.

### mail-transport-smtp

**The tenant-configured SMTP host must resolve to a public address**

**Migration:** An operator relying on an internal SMTP relay or a local dev/test server
(mailpit, MailHog on localhost or a private IP) now gets a build-time
422 (code "unconfigured", naming the "host" config-key) unless that host
is explicitly allowed. Set the operator env var (comma-separated, read
at connect time — no boot-time code call needed) before starting the
process:
  KUMIKO_MAIL_ALLOWED_PRIVATE_HOSTS=mailpit.internal
This is an operator env var, not a tenant config value — a tenant cannot
add their own host to this list. Shared with inbound-provider-imap: one
env var covers both SMTP and IMAP allowlisting. A DNS resolution failure
for a genuinely unreachable host now surfaces distinctly (not as
"unconfigured") instead of only failing later at first-send time.

### step-dispatcher

**A webhook.send target host must resolve to a public address**

**Migration:** A workflow or handler pointing `r.step.webhook.send` at an internal
receiver or a local dev/test endpoint (localhost or a private IP) now
gets a delivery error (step.dispatch-failed) unless that host is
explicitly allowed. Set the operator env var (comma-separated, read at
dispatch time — no boot-time code call needed) before starting the
process:
  KUMIKO_WEBHOOK_ALLOWED_PRIVATE_HOSTS=webhook-receiver.internal
This is an operator env var, not a tenant/workflow-config value — a
workflow author cannot add their own host to this list. A DNS resolution
failure for a genuinely unreachable host now surfaces as a distinct
delivery error instead of only failing later inside `fetch()`.

## 0.319.0

### billing-foundation

**start-plan-checkout and switch-plan reject with FeatureDisabledError, not UnconfiguredError, when no provider is mounted**

**Migration:** start-plan-checkout and switch-plan now reject with FeatureDisabledError
(code "feature_disabled", HTTP 403) instead of UnconfiguredError (code
"unconfigured", HTTP 422) when no provider is mounted for the catalog. A
caller that specifically catches UnconfiguredError from these two
handlers, or branches on the 422 status, must catch FeatureDisabledError
/ branch on 403 instead.

**billing-plans now reports a scheduled cancellation and the panel offers reactivation**

**Migration:** SubscriptionView and BillingPlansResult.subscription gain two REQUIRED
fields: `currentPeriodEnd` (a `Temporal.Instant`, ISO string on
BillingPlansResult) and `cancelAt` (`Temporal.Instant | null`, ISO
string or null on BillingPlansResult). Any test fake that constructs a
SubscriptionView object literal directly must add both fields.
BillingPlansResult.currentTier also gains a `benefits` field
(via `catalog.benefits(currentTier)`), computed even when currentTier is
outside `catalog.plans` (e.g. a legacy/free tier).

The Stripe provider now maps `subscription.cancel_at` (or
`current_period_end` when only `cancel_at_period_end` is set) into a new
`cancelAtIso` event payload field; process-event applies it with
set/clear/leave-unchanged semantics, so an event without the field never
wipes a previously recorded value.

BillingPlansPanel shows an info banner ("Your subscription is scheduled
to end on {date}") whenever `subscription.cancelAt` is set and the
subscription isn't terminal, and swaps the manage-subscription button's
label to "Reactivate subscription" in the same case. The synthetic
current-tier card (a tier outside `catalog.plans`, e.g. a legacy/free
tier) now also renders `catalog.benefits(currentTier)` and the same
manage/reactivate action as a catalog card, via a shared helper — no
action needed unless an app relied on that card being action-less.

`read_subscriptions` gains a nullable `cancel_at` column. Every app that
mounts billing-foundation — including a plain `billingFoundationFeature()`
with no catalog (e.g. kumiko-studio) — must run
`bun kumiko-schema generate <name>` (offlot-app wraps it as
`bun run schema:generate <name>`) and commit the resulting migration. Skipping this leaves
the app's own `read_subscriptions` table without the column, so the
projection's `apply` fails at the next subscription webhook. The column
is additive and nullable — no rebuild, existing rows keep it `null`
until their next subscription webhook.

**create-checkout-session's mode:"payment" now requires a declared one-off-price allowlist**

**Migration:** SubscriptionProviderPlugin gains an `oneOffPriceIds` field (a readonly
string array, defaulting to empty). create-checkout-session's
mode:"payment" branch now rejects any priceId that isn't in the
resolved provider's `oneOffPriceIds` with an UnprocessableError whose
details.reason is "unknown_price" (same shape as the existing
subscription-mode price check) — previously any priceId was accepted,
so a TenantAdmin could start a one-off checkout against an arbitrary
Stripe price. mode:"payment" also now goes through the same
isBillingEnabled gate as mode:"subscription", before the redirect-origin
check, and fails with FeatureDisabledError when billing isn't enabled.

Every provider mount that offers one-off purchases (credit packs,
top-ups, ...) must list their priceIds explicitly. offlot-app's
start-pack-checkout.write.ts mounts Stripe for credit-pack purchases via
mode:"payment" and needs its pack priceIds added, e.g.:
`createSubscriptionStripeFeature({ priceToTier, oneOffPriceIds: configuredPackPriceIds() })`
(or the equivalent option on its provider plugin), or every pack
checkout starts failing with "unknown_price" after this release.
`oneOffPriceIds` is validated at mount time — an empty-string entry or a
duplicate priceId now throws instead of silently widening/narrowing the
allowlist.

**create-portal-session now computes returnUrl server-side and honors the catalog's purchase roles**

**Migration:** create-portal-session's payload schema is now `z.object({}).strict()` — a
client that still sends `{ returnUrl }` gets a 400 instead of the URL
being honored. The server now computes returnUrl itself from
`catalog.returnPath` (joined onto `baseUrl`) or, without a catalog or
returnPath, from `baseUrl` directly; a foundation mounted without
`baseUrl` fails the call with UnconfiguredError on the "baseUrl" key,
same as create-checkout-session. Update any client call to
`portalMutation.mutate({})` — BillingPlansPanel already does this and no
longer reads `window.location.href`, which used to trigger
redirect_origin_not_allowed on a `www.`-prefixed origin. A server-internal
caller like offlot-app's open-portal.write.ts, which currently does
`ctx.write(SubscriptionFoundationHandlers.createPortalSession, { returnUrl })`,
must drop the `returnUrl` field from that call and instead set the return
target via `catalog.returnPath` (or, without a catalog, the target is
simply `baseUrl`).

Access control also changed: with a catalog configured, the handler's
allowed roles are now `catalog.purchaseRoles` (falling back to the
catalog's default purchase roles) instead of the hardcoded
TenantAdmin/SystemAdmin pair. An app that lets e.g. a plain Admin role
purchase plans must add that role to `catalog.purchaseRoles` to keep
portal access working; conversely, a role that isn't in
`purchaseRoles` now gets a 403 where it previously reached the handler.

Set `catalog.returnPath` to the app's billing page (e.g.
"/host/billing", or offlot's `${APP_BASE_PATH}/${MY_BILLING_SCREEN_ID}`),
otherwise the portal sends the user back to the bare `baseUrl`.

## 0.318.0

### billing-foundation

**create-checkout-session and create-portal-session are now hardened: origin-checked redirects, known-price validation, plan-switch conflicts**

**Migration:** Mount the foundation via createBillingFoundationFeature({ baseUrl }) (a
path prefix is fine, e.g. "https://app.example.com/tenant-x"). Without
baseUrl, every create-checkout-session call now fails with an
UnconfiguredError on the "baseUrl" key, including mode:"payment" checkouts.

create-checkout-session: successUrl/cancelUrl must share baseUrl's origin,
or the call fails with an UnprocessableError whose details.reason is
"redirect_origin_not_allowed". For mode:"subscription" (the default when
mode is omitted), priceId must be a price the resolved provider's
priceToTier map actually knows about, and, if a catalog is configured,
must map to one of catalog.plans, or the call fails with reason
"unknown_price". A tenant with an existing non-terminal subscription can
no longer open a second subscription checkout. A ConflictError with
i18nKey "billing-foundation.errors.subscriptionExists" fires instead; call
billing-foundation:write:switch-plan to change plans. mode:"payment"
(one-off top-ups etc.) is exempt from both the price and the
subscription-conflict check and keeps working on an active subscription
unchanged.

Provider plugins written before this release should add a priceToTier map
on their SubscriptionProviderPlugin; without one, every mode:"subscription"
checkout is rejected with reason "provider_has_no_price_catalog".

Direct-priceId callers of create-checkout-session should migrate to a
catalog plus billing-foundation:write:start-plan-checkout /
billing-foundation:write:switch-plan (or the BillingPlansPanel widget),
which pick the price server-side and never expose a raw priceId to the
client.

create-portal-session: when baseUrl is set, the payload's returnUrl must
also share its origin, or the same redirect_origin_not_allowed error
fires. Unchanged when baseUrl is not configured.

create-checkout-session: an optional providerCustomerId is now only
accepted if it belongs to the tenant's own subscription at the same
provider, including a canceled one. Otherwise the call fails with an
UnprocessableError whose details.reason is "foreign_provider_customer".
This closes a gap where a TenantAdmin could pass another tenant's
provider customer id and have the checkout attach to that customer's
stored payment methods and invoices. Checked in both mode:"subscription"
and mode:"payment".

## 0.317.0

### enterprise:testing

**bunfig --dom preloads the package's own DOM setup instead of an app-local file**

The package now exports `./preload/dom`, the happy-dom GlobalRegistrator
setup (IS_REACT_ACT_ENVIRONMENT, Bun's native fetch/Request/Response
preserved over happy-dom's broken cookie header, testing-library/react
cleanup, Radix pointer-capture/scrollIntoView stubs, the inspect-size
limit for waitFor) that each app using --dom previously copied into its
own ./test-setup/dom.preload.ts. `kumiko-testing bunfig --dom` now generates
bunfig.dom.toml with @cosmicdrift/kumiko-testing/preload/dom instead of
the app-local path. @happy-dom/global-registrator and
@testing-library/react are optional peer dependencies, same as
@playwright/test for ./e2e. This reverses kumiko-framework#3128, which
kept the file as an app-local copy because at the time it was
workspace-internal, not a published contract. In practice the copies
never diverged on purpose, only by drift: publicstatus, phronexsis and
kumiko-enterprise carried older, partial copies of the framework's own
test-setup/dom.preload.ts (missing the inspect-size fix for #3082), and
only offlot-app matched the framework's code (comments reworded, no
functional diff). The framework's own copy is now deleted; the
framework runs the same package preload it ships.

**Migration:** In every bunfig file that lists "./test-setup/dom.preload.ts"
(publicstatus, phronexsis, offlot-app and kumiko-enterprise each have
exactly one, their bunfig.dom.toml), replace that line with
"@cosmicdrift/kumiko-testing/preload/dom", then delete the now-
unreferenced ./test-setup/dom.preload.ts. Ensure
@happy-dom/global-registrator and @testing-library/react are in the
app's devDependencies (all four already have both). Running
`kumiko-testing bunfig --dom` instead also works: mergeBunfig now keeps
an app-local extra preload (publicstatus's
env.preload.ts/codegen.preload.ts) across the regen instead of dropping
it, and treats an existing "./test-setup/dom.preload.ts" entry as
superseded rather than an extra, so it doesn't end up preloaded twice
alongside the new package path. The generated preload array's own
entries stay first; a carried-over extra lands after them, which can
move it relative to entries that used to sit between the template's
preloads and the app's own (publicstatus: dom.preload.ts used to run
last, after env/codegen; the package preload now runs before them).

### framework-core

**"files: a valid upload (png/jpeg/gif/webp/pdf/doc/docx) under the wrong extension is normalized to its real type instead of rejected, when that type is in the field's accept list or the upload has no accept restriction at all"**

A real PNG or WebP saved with a .jpg extension (a common case for renamed
screenshots or messenger downloads) was rejected with content_mismatch
even when the field's accept explicitly allows png/webp, or when the upload
is unattached and has no accept restriction at all. validateFileContent now
also accepts the field's accept list; when the sniffed byte signature
doesn't match the declared extension but the sniffed type's own extension is
in accept, the upload proceeds under the sniffed mimeType with a storage key
built from the corrected extension, and the response reports the corrected
mimeType. When there is no accept restriction at all, any recognized
signature (png, jpeg, gif, webp, pdf, doc, docx) normalizes the same way.
The original filename is kept as the display name. A sniffed type whose
extension is not in a non-empty accept is still rejected with
content_mismatch.

**Migration:** validateFileContent's signature changes from (fileName: string, content: Uint8Array): string | null to (fileName: string, content: Uint8Array, accept?: readonly string[]): FileContentValidationResult ({kind:"ok"} | {kind:"normalized", extension, mimeType} | {kind:"rejected", error}). A direct caller that checked "if (result)" for an error must switch to checking result.kind === "rejected" and reading result.error — every branch of the new return type is a truthy object, so an unmigrated truthy check would now reject every upload. No caller besides the built-in POST /api/files route calls this function directly today (checked across kumiko-framework, kumiko-enterprise, kumiko-platform, kumiko-studio and every app consumer). buildStorageKey gains an optional trailing extensionOverride parameter; existing calls without it are unaffected.

## 0.315.0

### data-retention

**forget/policy-for now honor the tenant retention preset**

**Migration:** ResolveForTenantArgs.tenantPreset was renamed to preloadedTenantPreset (mirrors preloadedOverride): omitting it now makes the resolver load the tenant's retention preset itself instead of skipping it. Behavior change: forget (Art. 17) and the policy-for query now honor the tenant's compliance-profile-derived retention preset, not just entity defaults and per-tenant overrides. For tenants with a mapped compliance profile (e.g. de-hr-dsgvo-hgb), forget now keeps invoice/booking/contract rows via blockDelete and anonymizes order rows instead of hard-deleting them; notes-history mentions on such hosts are no longer shredded when the mentioned note's host entity is preset-protected. policy-for (data-retention:query:policy-for) now returns source: "preset" where it previously returned "none" for these entities.

### framework-core

**files: content verification is now keyed by filename extension, covering every signature-bearing type**

**Migration:** validateFileContent's signature changes from (mimeType: string, content: Uint8Array) to (fileName: string, content: Uint8Array): string | null. It now content-verifies every extension whose EXTENSION_MIME_WHITELIST entry overlaps MAGIC_BYTE_SIGNATURES (jpg/jpeg/png/gif/webp/pdf/doc/docx), not just doc/docx, and derives the check declaratively from the whitelist instead of a hardcoded per-format list. file-routes.ts now passes file.name instead of file.type (Bun derives File#type from the filename anyway, so the mimeType-keyed call was already comparing an extension-derived value to itself). A malicious extension shaped like a JS prototype property (constructor, __proto__, toString) resolves to "unknown extension" (no error) instead of crashing with a 500 — the same Object.hasOwn-guarded whitelist lookup is now shared by validateFile and validateFileContent. mime_mismatch remains a metadata-only pre-check; it is not real evidence of file content. Any test that uploads placeholder bytes (e.g. [1,2,3]) through the real upload route under one of the now-verified extensions must switch to real minimal signature bytes or a differently-named/unchecked extension.

## 0.314.0

### enterprise:testing

**seed-user only reaches a tenant this server's seed-tenant route created**

seed-user looked the tenant up via tenant:query:me and only rejected a tenant
id that did not exist at all, so a tenant seeded by another server or
in-process without this route's seed-tenant still got a user added. seed-user
now checks the same seededTenantIds set as /__test/seed and rejects any other
tenant with the same 403.

**Migration:** Create the tenant via `seedTenant()` (the seed-tenant route) before adding users with `tenant.addUser`.

## 0.313.0

### delivery

**delivery direct sends to a route address can now be unsubscribed via a signed link**

ctx.notify(type, { route: { email } }) direct sends had no unsubscribe
path: only sends to a user account with a notification-preference row
could opt out, so a recipient with no account could never stop the mail.
Added hashUnsubscribeAddress (keyed blind-index hash of the trimmed,
lowercased address — the plaintext address never reaches the token or
the opt-out table), signAddressUnsubscribeToken (HS256 JWT, issuer
"kumiko:unsubscribe", no expiry — a leaked link can only opt one
address out of one notificationType/channel, and there is no signed-in
flow to request a fresh one), and a new notification-address-opt-out
event-sourced entity/table. createUnsubscribeRoute now accepts both the
existing user token and the new address token on the same route; the
existing signUnsubscribeToken and its JWT shape are unchanged. deliverDirect
now skips a channel (logDelivery status "skipped", error "unsubscribed", recipientAddress null)
when the destination address has an opt-out row for that tenant/
notificationType/channel, unless priority is "critical" — the same rule
user-preference suppression already follows. The lookup is skipped
entirely when no blind-index key is configured.

**Migration:** Run `kumiko migrate generate` to add the notification address opt-out table.

### subscription-stripe

**subscription-stripe mode:"payment" checkouts now get a Stripe invoice by default**

createCheckoutSession's mode:"payment" call (one-off top-ups etc.) never
passed invoice_creation, so Stripe never generated an invoice document for
those payments. It now defaults to `invoice_creation: { enabled: true }`
for mode:"payment" — mode:"subscription" is unaffected, Stripe rejects
invoice_creation there. Stripe Invoicing charges a per-invoice fee on top
of the payment itself, so an existing high-volume, low-value payment flow
may see new fees appear.

**Migration:** Pass `createSubscriptionStripeFeature({ paymentInvoiceCreation: false })`
to opt out and keep the old no-invoice behaviour for mode:"payment" checkouts.

## 0.312.0

### document-ingest-foundation

**document-ingest-foundation is provider-driven; ALLOWED_MIME_TYPES/MAX_FILE_BYTES are gone**

**Migration:** The hardcoded MIME allowlist and fixed size cap are removed. A provider feature (e.g. kumiko-enterprise's LiteParse) now registers via r.useExtension(EXT_DOCUMENT_INGEST_PROVIDER, "<name>", { mimeTypes, maxFileBytes }) and routes its r.job's trigger through documentIngestProviderTrigger("<name>") instead of a bare { on: DOCUMENT_INGEST_REQUESTED_EVENT_QN }. A provider feature must also declare r.requires("document-ingest-foundation") — validateBoot rejects r.useExtension(EXT_DOCUMENT_INGEST_PROVIDER, ...) without it as a missing feature dependency. Boot now throws if: two providers claim the same mimeType, a job triggers on documentIngest.requested without a provider filter, a job filters to an unregistered provider name, or a registered provider has no job wired to it. documentIngest.requested's payload gained a required provider field (event schema version 2; a migration upcasts existing v1 events to provider: "unknown", a sentinel that cannot match any real provider filter). A file whose mimeType has no registered provider now appends documentIngest.skipped with reason unsupported-mime-type instead of file-too-large. A fileRef.deleted or fileRef.forgotten event now forgets that fileRef's documentExtract row (new forget-extract-with-file-ref table-less MSP) — previously the extract silently outlived a deleted/forgotten source file. Mounting documentIngestFoundationFeature with zero providers is valid: every upload is simply skipped as unsupported-mime-type. Boot only fails for a misconfigured wiring (unfiltered job on documentIngest.requested, a job filtered to an unregistered provider name, two providers claiming the same mimeType, or a registered provider with no job wired to it).

### framework-core

**MultiStreamApplyContext gains a required registry field**

**Migration:** Any hand-built MultiStreamApplyContext (e.g. in an MSP test that constructs the context object literal instead of using createMultiStreamApplyContext/setupTestStack) must add registry: <the app Registry instance>, the same instance HandlerContext/JobContext already expose. Lets an apply resolve extension-point usages (registry.getExtensionUsages) to pick behavior by payload discriminant, e.g. a provider-routed MSP.

## 0.311.0

### enterprise:guards

**test-timeouts is now always-enforcing, plus two new guards (test-template-drift, Real-Provider-Isolation)**

test-timeouts drops its transitional baseline/ratchet — any sleep loop,
test.setTimeout/test.slow, or waitForTimeout finding fails the guard run
directly, with no `.kumiko-test-timeouts-baseline.json` grandfathering
pre-existing violations.
New AST guard test-template-drift flags apps reimplementing the
kumiko-testing e2e/screenshot template locally: a Playwright config that
builds its own defineConfig(...) instead of calling defineAppE2eConfig(),
a literal deviceScaleFactor override anywhere (test.use, a project's use,
or the config's own use block), a literal viewport override in a
playwright*.config.ts's own use or a project's use (a spec's own
test.use({ viewport }) is not flagged — it's the documented way to assert a
layout that only exists below the template's 1920px default; a
`...devices["…"]` spread stays allowed everywhere), or a direct
page.screenshot(...) call instead of captureScreenshot.
New repo check Real-Provider-Isolation flags a CI workflow that references
KUMIKO_REAL_PROVIDERS or invokes test:real/e2e:real, a package.json script
other than test:real/e2e:real that leaks the real-provider env or a
*.real. spec/test reference, and one of the template's own non-real bunfig
files (bunfig.toml, bunfig.integration.toml, bunfig.dom.toml) missing the
**/*.real.test.ts exclusion.

**Migration:** Fix or mark each test-timeouts finding: replace hand-rolled poll loops with
the shared `waitFor` from @cosmicdrift/kumiko-framework/testing, or add
`// @timeout-exception: #<issue> <technical reason>` on the loop's own line
or the line above for a genuine non-condition wait. Delete any committed
`.kumiko-test-timeouts-baseline.json`.
For test-template-drift: switch a hand-rolled Playwright/screenshot config
to defineAppE2eConfig(), drop config-level viewport/deviceScaleFactor
overrides (the template already sets DESKTOP_VIEWPORT and renders
screenshot runs at SCREENSHOT_DEVICE_SCALE_FACTOR), and replace direct
page.screenshot(...) calls with the template's captureScreenshot. Specs
asserting a layout that only exists below 1920px set their own viewport via
test.use({ viewport }) — no exception marker needed. A deliberate exception
for anything else the guard flags (e.g. a handbook screenshot helper that
needs its own viewport-growth pass) is
`// @template-drift-exception: #<issue> <technical reason>` on the line
above.
For Real-Provider-Isolation: remove any KUMIKO_REAL_PROVIDERS/test:real/
e2e:real reference from CI workflows, move real-provider env/spec
references out of scripts other than test:real/e2e:real, and regenerate
bunfig.toml/bunfig.integration.toml/bunfig.dom.toml via
`kumiko-testing bunfig` instead of hand-editing pathIgnorePatterns.

### enterprise:testing

**defineAppE2eConfig's chromium project renders screenshot runs at deviceScaleFactor 2**

With SCREENSHOT_DIR set, the chromium project renders at 2x so runMatrix and
captureScreenshot images stay sharp on HiDPI displays (desktop files are
3840×2160). Plain e2e runs stay at 1x. Device projects keep their own scale.

**Migration:** Drop app-level deviceScaleFactor overrides (test.use or project use).
Committed screenshots taken in the chromium project regenerate at 2x.

## 0.310.0

### enterprise:testing

**defineAppE2eConfig's chromium project runs at 1920×1080 instead of Desktop Chrome's 1280×720**

The template took Playwright's "Desktop Chrome" device unchanged, so every
e2e run and every inline captureScreenshot rendered at 1280×720 while
runMatrix's desktop screenshots used 1920×1080. Both now share
DESKTOP_VIEWPORT (1920×1080). A root `use.viewport` override in an app's
playwright config never reached the chromium project anyway (project `use`
wins), so solon's 1920 override was silently ineffective.

**Migration:** Drop app-level desktop viewport overrides. Specs asserting a layout that
only exists below 1920px (collapsed sidebar, stacked panes) set their own
viewport via test.use({ viewport }). Committed inline screenshots taken
in the chromium project regenerate at 1920 width.

## 0.309.0

### data-retention

**data-retention hardDelete now purges file bytes + fileRef rows, not just the entity row (fw#3089)**

**Migration:** hardDelete previously deleted only the entity row and left every file/image/files/images field's storage bytes and `file_refs` row behind — a DSGVO Art. 17 gap. As of this release, an expired row's un-shared fileRefs (same tenant, bound to this row, not referenced by another row of the same entity) have their storage bytes deleted (including derivatives/thumbnails), then their `file_refs` row, then the entity row itself. A fileRef still referenced by another row, or bound to a different entity/record, is left untouched. Without a resolvable file-storage provider in the retention cron's job context, an entity with pending file deletions is skipped entirely (`skipped` reason `missing_file_storage`) rather than silently dropping the row with orphaned bytes; a storage-delete failure skips the row too (`file_delete_failed`) and retries on the next run. Before upgrading, a consumer relying on hardDelete NOT touching file storage should: list entities with `retention.strategy: "hardDelete"` and at least one file/image/files/images field, count rows already past `keepFor` for each, and confirm the referenced files are safe to delete (not needed elsewhere) before the next cron run.

### enterprise:testing

**reducedMotion defaults to "reduce" in runScreenshots/runMatrix/captureScreenshot; captureScreenshot(page, name) added**

rAF-driven chart/tween animations were invisible to the settle-detection
wait, so screenshots sometimes captured a mid-animation frame. Both matrix
helpers now call page.emulateMedia({ reducedMotion: "reduce" }) at test
start, before the first navigation. The new captureScreenshot(page, name,
opts?) applies the same media emulation at capture time, so it only affects
animations started after that point; set reducedMotion via test.use() for
mid-flow shots of charts that animate on mount. captureScreenshot reuses the
matrix runner's settle logic, writes $SCREENSHOT_DIR/<name>.png, and is a
no-op when SCREENSHOT_DIR is unset, for solon's mid-flow shot(page, id) and
offlot's inline page.screenshot writes into docs/screenshots/e2e/.

**Migration:** Pass `reducedMotion: "no-preference"` in runScreenshots/runMatrix's
options, or as captureScreenshot's third argument, for a scenario that
must keep real motion.

## 0.308.0

### framework-core

**Boot validator rejects a projectionDetail screen/section/emptyState action with no resolvable icon (fw#3234)**

**Migration:** Every screen.actions / section.actions / section.emptyState.action entry on a projectionDetail screen, and every section.actions entry on an entityEdit screen, must resolve an icon: either an explicit `icon` on the action, or an id the shared action-icon map (@cosmicdrift/kumiko-types resolveActionIcon) already derives from the full id or its last/first kebab segment. entityEdit's own screen-level `actions` are not checked (unchanged, out of scope for this rule). An action that fails this now fails boot instead of rendering without an icon; give it an explicit `icon` or rename it to an id the map covers.

**Session and PAT revoke now close their own credential's open SSE stream, not just other reasons' userwide invalidations**

**Migration:** An app-injected SseBroker implementation must update its subscribeAccessInvalidation/publishAccessInvalidation signatures: the third parameter of subscribeAccessInvalidation is now an AccessInvalidationCredential object (`{ sid?, patTokenId? }`) instead of a bare sid string, and the second parameter of publishAccessInvalidation is now an AccessInvalidationScope object (`{ kind: "user" } | { kind: "all-except-session"; keptSessionId } | { kind: "sessions"; sessionIds } | { kind: "pat-tokens"; tokenIds }`) instead of a bare keptSessionId string. Example: `subscribeAccessInvalidation(userId, cb, sid)` becomes `subscribeAccessInvalidation(userId, cb, { sid })`, and `publishAccessInvalidation(userId, keptSessionId)` becomes `publishAccessInvalidation(userId, { kind: "all-except-session", keptSessionId })`.

### notes-history

**NotesSection no longer wraps its own "new note" / "history" blocks in a Card (fw#3234)**

As an extension section (its documented usage: `component: { react: { __component: NOTES_SECTION_EXTENSION_NAME } }`), NotesSection was already mounted inside the host's own section frame — its two internal Cards doubled the border/padding there. Both blocks now use a plain container with a `Heading variant="section"` sub-header instead.

**Migration:** A standalone `<NotesSection entityName={...} entityId={id} />` mount (outside a screen-schema extension section) now renders both blocks without their own card chrome — wrap it in a `Section`/`Card` if the standalone mount needs one.

## 0.307.0

### framework-core

**The public-intake gate now also covers jobs, event-triggered jobs, anonymous query roots and TenantDbs built from ctx.db.unsafeRaw (fw#3185)**

**Migration:** An anonymous handler (roles include "anonymous") without personalData: "public-intake" now fails when personal data (pii / userOwned / recordOwned) is written through any of these paths: a job it enqueues (write or query root), a job triggered by its handler event or by an r.defineEvent it appends, a job chained from such a job, a job ctx.write/writeAs into another handler, or a TenantDb built with createTenantDb on a ctx.db.unsafeRaw / ctx.systemDb.unsafeRaw runner (including savepoints on it). The error is AccessDeniedError with details.reason "public_intake_required"; for jobs details.job names the job and the job run fails. Declare access: { roles: [..., "anonymous"], personalData: "public-intake" } on the root write handler if the anonymous intake is intended, otherwise stop writing the field from that path. A query root cannot declare public-intake: move the enqueue from an anonymous query handler into a write handler that declares it. Raw SQL through unsafeRaw stays escapeHatch plus audit. Jobs without a stamped origin (cron, boot, jobs dispatched outside a request, jobs queued before this release) run as before; a job whose _writeOrigin is present but invalid fails before its handler runs.

## 0.306.0

### enterprise:testing

**mailCapture and the /__test/inbox route read tenantless mail via a new mailOutbox option**

Apps sending Dev/E2E mail through a raw createInMemoryTransport() (signup,
forgot-password, magic-link — flows with no tenant) had no way to read it
through the seed inbox route, which required tenantId and only checked
mailTransportInMemoryFeature's per-tenant buffer. createE2eSeedRoutes()
now accepts mailOutbox: { sent: readonly EmailMessage[] } (the raw
transport's own array); inboxQuerySchema's tenantId is optional. The route
reads whichever source(s) are configured, filters by to, and returns each
source newest-first instead of oldest-first.

**Migration:** mailCapture(request, tenantId, to) -> mailCapture(request, to, { tenantId }),
and it now resolves to a single CapturedMail (the newest match) instead of
a readonly CapturedMail[]. Pass match: (mail) => boolean to pick a mail
other than the newest at that address. Apps with their own ungated debug
route for a raw transport (e.g. /_debug/mails.json) pass that transport as
createE2eSeedRoutes({ mailOutbox: transport }) and delete the app-local
route; tenantId becomes optional wherever only mailOutbox is used. Any
direct reader of GET /__test/inbox must expect newest-first ordering.

### framework-core

**A lifecycle hook's own escapeHatch now gates ctx.systemDb.unsafeRaw (fw#3198)**

**Migration:** Hooks, die in r.systemScope()-Handlern ctx.systemDb.unsafeRaw nutzen, deklarieren escapeHatch: { reason } in den r.hook-Optionen

**createUncheckedSystemDb is no longer exported from /db; use createSystemDbView, whose unsafeRaw follows the source TenantDb's escapeHatch gate (fw#3205)**

**Migration:** Import auf createSystemDbView umstellen; wer unsafeRaw auf einem selbstgebauten systemDb braucht, übergibt eine TenantDb mit unsafeRaw-Grant (createTenantDb(..., { unsafeRaw: { reason } })).
Delivery: ein tenantUserIdsQuery-Handler ohne r.systemScope() bekommt jetzt wie im Dispatcher eine tenant-mode ctx.db und kein ctx.systemDb; Handler, die Cross-Tenant-Zugriff brauchen, deklarieren r.systemScope().

**r.useExtension options are typed per extension point; a hook with the wrong ctx signature is a compile error**

**Migration:** Registrations of known extension points (tenantData, userData, fileProvider, derivativeRenderer, derivativeOverlayResolver, derivativePublicPredicate, principalStatus, tenantLifecycleStatus, tokenVerifier, sessionStore, tenantResolver, tenantExistence) now type-check their options, and options are required for them. Fix the reported mismatches: tenantData destroy hooks take TenantDataHookCtx and use ctx.db.* methods. For raw access such as archiveStream, declare escapeHatch: { reason } on the r.useExtension registration (runtime grant), call declareEscapeHatch({ reason }) as a direct statement in the hook body (Escape-Hatch-Declared guard), then use ctx.db.unsafeRaw(reason). userData registrations need at least one of export/delete (plus optional order). PrincipalStatusPlugin needs resolveProfile, FileProviderPlugin fakes need list(). App-owned points can opt in by augmenting KumikoExtensionOptionsMap via declare module "@cosmicdrift/kumiko-framework/engine"; unknown names keep the untyped options bag.

**Tenant-resource and tenantTierResolver extension options are typed; invalid registrations fail tenant destroy loudly**

**Migration:** Registrations of storageProvider, searchAdapter, externalResource and infraResource now require options of type TenantResourceExtensionHooks (destroyTenant(tenantId, ctx) => Promise<void>); tenantTierResolver requires a TierResolverPlugin with build. StorageProvider* types remain as aliases of the new TenantResource* types. A tenantData or tenant-resource registration whose destroy hook is missing now fails the destruction stage with the extension and entity name instead of being skipped.

**Idempotent retries re-run after a rolled-back 5xx instead of replaying it**

Because the retry re-runs, non-transactional side effects of the failed attempt (writes through `ctx.dbOutsideTransaction`, external calls made inside the handler) run again.
`IdempotencyGuard` has a new required method `release(tenantId, userId, requestId, token)` that frees the in-progress lock (token-guarded, like `store`) instead of persisting a result.

**Migration:** Custom IdempotencyGuard implementations must add release(tenantId, userId, requestId, token), which deletes the pending lock only if it still holds that token

### renderer-foundation

**Bundled extension points (renderer, deliveryChannel, mailTransport, inboundMailProvider, subscriptionProvider) are typed**

**Migration:** r.useExtension options for renderer ({ kinds, render }), deliveryChannel ({ mode, resolve, render?, send, accept? }), mailTransport (MailTransportPlugin), inboundMailProvider (InboundMailProviderPlugin) and subscriptionProvider (SubscriptionProviderPlugin) are now type-checked and required; renderer and deliveryChannel registrations do not pass name (it comes from the entity name). Prefer the new constants RENDERER_EXTENSION, DELIVERY_CHANNEL_EXTENSION and MAIL_TRANSPORT_EXTENSION over string literals. A registration whose options do not match the plugin shape now throws with the entity name when channels or renderers are collected.

## 0.305.0

### auth-email-password

**Session bootstrap failures now render a retryable error screen instead of hanging on "loading"**

fetchTenants()/fetchCurrentUser() failures (rate limit, 5xx, network)
used to reject out of the session bootstrap effect and leave the UI on
the loading placeholder forever. SessionStatus gained an "error" value
and SessionState gained a bootstrapFailure field; the auth gate now
renders SessionBootstrapErrorScreen with a Retry-After-aware retry
button for this case.

**Migration:** Code with an exhaustive switch over SessionStatus, or tests/stories that
hand-build a SessionState literal, needs to add the "error" case and the
bootstrapFailure field. refresh() no longer rejects on bootstrap
failures; it resolves and sets status to "error" instead.

### framework-core

**rateLimit.auth (L2) no longer throttles GET /api/auth/tenants**

The SPA's own session bootstrap called GET /api/auth/tenants on every
page load, which counted against the L2 auth-endpoint bucket and threw
429 on the 6th page load within a minute. This route is now exempted
from rateLimit.auth by exact method+path match; all other auth routes
(including POST on the same path, if ever added) are unaffected.

**Migration:** Apps using the default rateLimit.auth need no changes. Apps that want
to keep throttling GET /api/auth/tenants should rely on rateLimit.global
(L1, IP-based) instead. Credential-submitting POST routes are unaffected
even when rateLimit.auth's `path` option is customized.

**Writes under an anonymous root need access.personalData: "public-intake" at runtime, across feature boundaries (fw#3165)**

The boot check from fw#2885 only sees personal-data keys in an anonymous write handler's own input schema, for entities of its own feature. Every public dispatch (write, batch command, query, stream) now computes a WriteOrigin (root handler, anonymous root, public-intake declared) once. Every nested call inherits it: ctx.write, ctx.writeAs, ctx.query, ctx.queryAs, nested writes and afterCommit hooks. When the root is anonymous and does not declare public-intake, a write that touches a personal-data field (pii / userOwned / recordOwned) of any registered entity fails with AccessDeniedError, details.reason "public_intake_required". The error details name the root handler, the table and the fields, never the values. The check runs in TenantDb.insertOne/updateMany, in db.global().insertOne/updateMany and in the event-sourced create/update executor, after preSave and before the event append. It also covers rebound TenantDbs (acknowledgeCrossTenant, hook re-gating). Authenticated sessions are not affected. Not gated: ctx.db.unsafeRaw (covered by escapeHatch plus audit); ctx.appendEvent on a feature's own events (foreign events are already rejected); tables outside the registered entities; jobs and event subscribers queued from an anonymous root; and TenantDbs that handler code builds directly with createTenantDb. The last two are tracked in fw#3185, which also lists the bundled auth-email-password and user-data-rights flows that go through unsafeRaw or createTenantDb.

**Migration:** A write handler that anonymous callers can reach (roles include "anonymous") and that writes a personal-data field (pii / userOwned / recordOwned) of any entity must declare access: { roles: [..., "anonymous"], personalData: "public-intake" }. This applies whether the handler writes the field itself or through ctx.db, the CRUD executor, ctx.write, ctx.writeAs/queryAs or a postSave/afterCommit hook, and it applies across features. Without the declaration the write now fails with AccessDeniedError (details.reason "public_intake_required"). A failing afterCommit hook is only logged, and its write does not happen. Known consumer handlers, measured on 23.09.2026: offlot-app waitlist:submit, vehicle-enquiry:submit and try-first:set-contact; publicstatus email-subscriber:subscribe; show-pony rsvp:submit. Add the declaration if the anonymous intake is intended (the handler's rateLimit is then the only protection). Otherwise stop writing the field from the anonymous path.

## 0.303.0

### framework-core

**r.httpRoute's `anonymous` field is now required and controls the mount, not just docs (fw#2885)**

HttpRouteDefinition.anonymous changes from an optional, purely-documentary boolean to a required one that drives buildServer's mount. `anonymous: true` stays public, unchanged. `anonymous: false` now mounts the route behind the same session-auth chain /api/* uses: no anonymous fallthrough (a request without a session gets 401, never a synthesized anonymous user), the same PAT rate-limit guard, origin-allowlist guard and double-submit CSRF guard as /api/*, in the same order (auth → PAT → origin → CSRF). The handler reads the caller via getUser(c). feature-ui-extensions' httpRoute() now throws at feature-setup time when `anonymous` is missing or not a boolean (catches JS callers without the TypeScript type). The feature-AST (patterns/render/patcher/extractor/pattern-library) mirrors the field as required; a source file parsed before this change (missing `anonymous`) reads as `anonymous: false` — the safe side — and round-trip rendering always emits the field explicitly.

**Migration:** Every r.httpRoute({...}) call site must declare anonymous: true | false. Routes that were implicitly public (no field, or anonymous: true) keep working unchanged once anonymous: true is added explicitly — feature-ui-extensions now throws at boot for a route missing the field. Routes meant to require a session must set anonymous: false; a request without a session then gets 401 instead of running (there is no anonymous fallthrough on those routes any more), and a cookie-authenticated state-changing request needs the same X-CSRF-Token as /api/* or gets 403. Feature-AST round-trips: a saved feature file that predates this change parses `anonymous` as false (not true) — audit any httpRoute that was implicitly public and add `anonymous: true` before re-saving through the Designer/AI editor, or the next render will lock it behind the session-auth chain.

## 0.302.0

### framework-core

**Anonymous write handlers whose input accepts a personal-data field must declare access.personalData: "public-intake" (fw#2885)**

RoleAccessRule ({ roles, personalData? }) gains an optional personalData?: RoleAccessPersonalData (currently only "public-intake"), exported from @cosmicdrift/kumiko-framework/engine and /ui-types alongside OpenToAllPersonalData. validateAccessDeclarations now requires personalData: "public-intake" on a write handler whose access.roles includes "anonymous" and whose input schema accepts a personal-data field (pii / userOwned / recordOwned) of an entity in the same feature; declaring personalData on the roles form of a query or stream handler is rejected, "public-intake" on roles without "anonymous" is rejected, and "tenant-members" on the roles form is rejected (openToAll keeps accepting only "tenant-members"). Unlike the existing openToAll owner-binding exemption, an anonymous handler is never exempted by an owner-bound access.write map: every anonymous caller shares one user.id ("anonymous"), so from("user:id", ...) binds no one specific. The feature-AST extractor (readOptionalAccessRule) reads roles.personalData the same way it already reads openToAll.personalData.

**Migration:** A write handler with "anonymous" in access.roles whose input schema accepts a personal-data field of an entity in the same feature now fails boot until it declares access: { roles: [..., "anonymous"], personalData: "public-intake" }. Owner-binding via from("user:id", "<column>") on the entity access.write does not exempt an anonymous handler (it does exempt an openToAll handler) — anonymous requests share a single caller identity, so rely on the handler's required rateLimit (per ip) instead. personalData: "public-intake" is only valid on the roles form and only with "anonymous" in roles; openToAll keeps accepting only personalData: "tenant-members". The check only sees entities of the handler's own feature; anonymous intake into another feature's entity is covered by the follow-up runtime gate (kumiko-framework#3165). No known bundled-feature handler is affected.

## 0.301.0

### billing-foundation

**billing-foundation no longer exports SystemWriteResult (removed in 0.298.0 without a changelog note)**

**Migration:** SystemWriteResult was exported from @cosmicdrift/kumiko-bundled-features/billing-foundation up to 0.297.0 and was dropped in 0.298.0 together with the dispatchSystemWrite dep of createSubscriptionTierSync; there is no alias. Code that still imports it fails with "has no exported member 'SystemWriteResult'". If the type is only used for a dispatchSystemWrite dep passed to createSubscriptionTierSync, drop that dep and the type together (see the 0.298.0 webhook-wiring migration: extraRoutes: [createSubscriptionTierSync({ ... }).createWebhookRoute()]). Where a system-write result type is still needed, import type { WriteResult } from "@cosmicdrift/kumiko-framework/engine" and use WriteResult<unknown>; it is a discriminated union ({ isSuccess: true; data } | WriteFailure), so narrow on isSuccess before reading data or error.

## 0.300.0

### auth-email-password

**auth handlers switch from GUEST_USER (roles: ["all"]) to the anonymous identity with a per-IP rateLimit**

**Migration:** The auth-email-password and auth-mfa handlers reachable from unauthenticated /auth/* routes (login, invite-accept-with-login, invite-signup-complete, reset-password, signup-confirm, verify-email, confirm-account-unlock, signup-request, the token-request handlers, mfa verify, mfa enable-start-preauth, mfa enable-confirm-preauth) now declare access: { roles: ["anonymous"] } instead of access: { roles: ["all"] }, each with its own rateLimit: { per: "ip+handler", limit, windowSeconds }. Enforcing that rateLimit on a request that carries a client IP requires a RateLimitResolver (Redis), same as the already rate-limited self-registration-status query; without one these handlers fail with InternalError (fail-closed, #1467). The password-reset, email-verification and account-unlock request routes keep answering 200 for anti-enumeration, so there the failure shows up as a "[kumiko] token request handler ... failed" error log line and no mail is sent. Wire Redis (or context.rateLimit) before relying on these routes. Test fixtures that hand-roll a guest SessionUser with roles: ["all"] must switch to roles: ["anonymous"] (or createAnonymousUser from @cosmicdrift/kumiko-framework/engine).

### framework-core

**Remove the guest-identity all-role: unauthenticated handlers must declare roles: ["anonymous"] with a rateLimit**

**Migration:** Handlers declared with access: { roles: ["all"] } now fail boot — no session ever carries the role "all", so this is unreachable dead config, not a wildcard. Switch to access: { roles: ["anonymous"] } plus rateLimit: { per: "ip" | "ip+handler", limit: N, windowSeconds: N } for unauthenticated callers, or access: { openToAll: { reason: "..." } } for any signed-in user. Test fixtures that hand-roll a SessionUser with roles: ["all"] (bridgeStub, hand-rolled guest literals) must switch to createAnonymousUser(tenantId) or roles: ["anonymous"]. buildSessionRoles now also strips "anonymous" and "all" out of globalRoles at every JWT mint (membership roles were already stripped). auth-routes.ts now dispatches every public /auth/* write with createAnonymousUser(SYSTEM_TENANT_ID) instead of the removed GUEST_USER constant.

## 0.298.0

### billing-foundation

**Billing webhook wiring moves from a raw handler to createSubscriptionWebhookRoute()/createWebhookRoute()**

**Migration:** createSubscriptionWebhookHandler(...) is replaced by createSubscriptionWebhookRoute({ path?, afterDispatch? }), which returns an ExtraRouteDefinition for the extraRoutes array instead of a manually-mounted handler; the route path still defaults to /webhooks/subscription/:providerName. createSubscriptionTierSync(...) deps drop db, registry, dispatchSystemWrite and tierAssignmentTable - it now exposes .createWebhookRoute(), which produces the signature-verified ExtraRouteDefinition to add to extraRoutes. A webhook previously wired as extraRoutes: (app, deps) => { app.post("/webhooks/subscription/:providerName", createSubscriptionWebhookHandler(...)) } becomes extraRoutes: [createSubscriptionTierSync({ ... }).createWebhookRoute()] (or createSubscriptionWebhookRoute({...}) for the lower-level handler), with db/registry/dispatchSystemWrite no longer passed in - the route's signature-entry deps (systemQuery, dispatchSystemWrite, dispatchSystemQuery) cover the read/write access the old handler needed.

### enterprise:dev-server

**createKumikoServer/runDevApp take ExtraRouteDefinition[]; dev hostDispatch gets systemQuery**

**Migration:** extraRoutes on createKumikoServer/runDevApp changes from (app, deps) => void to readonly ExtraRouteDefinition[] - see the framework core changelog entry for the route-kind/dep breakdown. wire?: (deps: SystemWireDeps) => void | Promise<void> replaces non-route setup previously done inside the old extraRoutes callback. The dev hostDispatch callback now receives a second argument { systemQuery }; a dispatch implementation reading the dev db directly switches to systemQuery.

### enterprise:server-runtime

**ExtraRoutesSystemDeps renamed to SystemWireDeps; hostDispatch gains systemQuery**

**Migration:** ExtraRoutesSystemDeps is renamed to SystemWireDeps and now backs the new wire hook instead of extraRoutes; WorkerWireDeps is derived from it. A consumer importing ExtraRoutesSystemDeps from server-runtime must switch to SystemWireDeps (same shape: db, redis, registry, dispatchSystemWrite). HostDispatchFn passed to runProdApp now takes a second argument { systemQuery } - a dispatch function reading db directly for routing decisions must switch to systemQuery.

### enterprise:testing

**createE2eSeedRoutes() returns ExtraRouteDefinition[] instead of an extraRoutes callback**

**Migration:** createE2eSeedRoutes() now returns readonly ExtraRouteDefinition[] instead of an (app, deps) => void callback. The call site extraRoutes: createE2eSeedRoutes() in setupTestStack is unchanged, but any code that imported createE2eSeedRoutes() to invoke it directly against app (rather than passing it through extraRoutes) must instead treat the result as a route list, e.g. register each entry through the framework's ExtraRouteDefinition handling.

### framework-core

**extraRoutes/hostDispatch move to structured route and wire definitions**

**Migration:** extraRoutes on runProdApp/createKumikoServer/runDevApp/setupTestStack changes from (app, deps) => void to readonly ExtraRouteDefinition[]. Each entry is { method, path, entry: "anonymous" | "user" | "signature", handler }, built via the helpers in @cosmicdrift/kumiko-framework/api; a signature route also needs verify(request, deps) via signatureRoute<T>(). An anonymous GET route that used to call app.get(path, handler) on the raw app now receives { app, registry, systemQuery } - replace direct db/redis reads with systemQuery. A route reading user data via a raw db handle now declares entry: "user" (path must live under /api/, unauthenticated requests get 401 automatically) and receives { app, registry, user, query, write } instead of db/redis. A route verifying an external signature (webhooks) declares entry: "signature" and receives { app, registry, secrets?, systemQuery, dispatchSystemWrite, dispatchSystemQuery }; reject invalid signatures with ExtraRouteRejection(status, body) from verify. Non-route setup that used to run inside the old extraRoutes(app, deps) callback (late-binding, background seeds, starting a runner) moves to the new wire?: (deps: SystemWireDeps) => void | Promise<void> option on runProdApp/createKumikoServer, which gets { db, redis, registry, dispatchSystemWrite } but no app. hostDispatch (dev) and HostDispatchFn (runProdApp) gain a second argument { systemQuery }; an app.use middleware that read db directly for host dispatch now uses systemQuery instead.

### inbound-mail-foundation

**createInboundMailConnectRoutes() returns ExtraRouteDefinition[] with static options only**

**Migration:** createInboundMailConnectRoutes(options) now returns readonly ExtraRouteDefinition[] (connect route as entry: "user", callback route as entry: "signature") instead of mounting itself on app. options is now static config only - any db/registry/dispatch values previously passed through options are supplied by the framework via the route's deps instead. Replace extraRoutes: (app, deps) => createInboundMailConnectRoutes(options)(app, deps) with extraRoutes: createInboundMailConnectRoutes(options) (spread into the app's route array alongside other route definitions).

## 0.296.0

### delivery

**delivery requires tenant**

**Migration:** delivery now declares r.requires("tenant") because its delivery-log screen references tenant:tenant. Stacks that mount delivery must also mount createTenantFeature() (and its config dependency).

### framework-core

**refEntity on projectionList/relatedList columns and projectionDetail fields is boot-checked against registered entities**

**Migration:** A refEntity that does not resolve to a registered entity now fails boot with the target and the known entities of the target feature (same message as a reference facet). Fix the typo, or mount and r.requires() the target feature; test stacks booting a feature without its refEntity target feature must add it.

## 0.291.0

### framework-core

**projection-rebuild aborts instead of silently NULLing populated blind-index columns (fw#3091)**

`kumiko schema apply` rebuilds a projection through a fresh shadow table replay, and the shadow always recomputes every `<field>_bidx` column with whatever blind-index key is configured in the running process. A projection rebuilt in a process without `KUMIKO_BLIND_INDEX_KEY` set — most commonly the `migrate-db` init container that runs `kumiko schema apply` on deploy — silently swapped the live table for one where every bidx column had gone NULL, breaking equality lookups (login, password reset) with no error anywhere. `rebuildProjection` now checks, right before the swap, whether the live table already has populated bidx columns while no key is configured in this process; if so it throws and leaves the live table untouched instead of completing the swap.

**Migration:** Plaintext installations and the fw#1610 case (KMS configured, no blind-index
key) are unaffected — their bidx columns are NULL already, so there is
nothing for the rebuild to lose. This only blocks a rebuild that would
otherwise destroy already-populated bidx columns: any process running
`kumiko schema apply` (or another projection rebuild) against a table with
live blind-index data must have `KUMIKO_BLIND_INDEX_KEY` set. Wire that env
var into the `migrate-db` init container (or wherever schema apply runs in
deploy) alongside the app's own KUMIKO_BLIND_INDEX_KEY, or the rebuild aborts
instead of quietly breaking equality lookups.

**Declared event PII fails closed without a subject KMS (fw#2776)**

`defineEvent` has required an explicit PII stance since fw#2558, but a declared stance still did not guarantee ciphertext in `kumiko_events`. Two paths leaked silently and now fail closed.
Boot: `assertPiiBootInvariants` only looked at entity annotations, so an app whose PII lives exclusively in catalogued events booted without a `kms` adapter and wrote plaintext. It now collects events with a non-`"none"` stance alongside the PII entities — prod aborts, dev warns, `allowPlaintextPii: "<reason>"` acknowledges, same as for entities.
Append: `{ personal: { of: "<ownerField>" } }` skipped encryption whenever the owner field carried no id, so the same event type was ciphertext for user-triggered writes and plaintext for system-triggered ones with no signal. The stance now carries `whenAbsent`: `"tenant"` encrypts under the envelope tenant key, `"plaintext"` is an explicit acknowledgement that the value cannot be crypto-shredded. Registration rejects a nullable owner field without one, and an owner that is empty at append time with no declared fallback aborts the write instead of storing the value in the clear.
`delivery:event:attempt` declares `whenAbsent: "tenant"` — a send whose `recipientId` is null now stores the recipient address under the tenant key instead of in plaintext.

**Migration:** Three things can newly fail. (1) Boot aborts with `BOOT ABORTED — ... events
[...]` when a mounted feature declares a non-`"none"` `piiFields` stance and
`runProdApp`/`runWorkerApp` gets no `kms`. Pass
`kms: createPgKmsAdapter({ databaseUrl, platformKek })`, or acknowledge the
plaintext with `allowPlaintextPii: "<reason>"` until the KMS is provisioned;
`runDevApp` only warns. (2) Registration aborts when a
`{ personal: { of: "<ownerField>" } }` stance names an owner field the payload
schema allows to be null or undefined. Add `whenAbsent: "tenant"` to encrypt
those writes under the envelope tenant key, or `whenAbsent: "plaintext"` to
declare that the value ships unencrypted and is not crypto-shreddable. The
deprecated `{ subjectField: "<ownerField>" }` form cannot express `whenAbsent`
— move it to the canonical `{ personal: { of: ... } }` form. (3) `append()`
throws `SubjectResolutionError` when the owner field is empty at write time
and the event declared no `whenAbsent`. Registration catches this for
ZodObject payload schemas; a non-object schema surfaces it here. An owner
value that is not a non-empty string — a numeric id, an empty string — counts
as absent, so it takes the same path and needs the same declaration.
Separately, `delivery:event:attempt` rows written with a null `recipientId`
used to hold a plaintext recipient address in `kumiko_events` and in
`store_delivery_attempts`. New rows are tenant-subject ciphertext.
`delivery:query:log` decrypts either form, so the admin log view is unchanged;
tooling that reads `store_delivery_attempts.recipient_address` directly must
go through `decryptStoredPii`. Existing plaintext rows stay readable and are
re-encrypted by `backfillEventPiiEncryption`.

**money fields on actionForm/secretMint screens declare their currency source (fw#2839)**

`actionForm` and `secretMint` have no entity, so their money fields never received `entity.defaultCurrency`: an untouched one seeded a bare `0` that the handler's zod schema then rejected on submit. fw#2763 closed the prefill half of this; the default half stayed open. `MoneyCurrencySource` gains `{ kind: "literal", code }` next to the existing `{ kind: "tenant" }`, and the field maps of `actionForm`, `secretMint` and its `confirm` step are narrowed so a money field there requires `currency` — enforced by the compiler at bump time and by the boot validator for untyped callers. A literal code is checked against the app's `currencies` list, the same rule `entity.defaultCurrency` already follows. Entity fields, embedded-list money cells and `configEdit`'s plain-number contract are unchanged.

**Migration:** Only affects entity-less form screens — `actionForm`, `secretMint` and a
secretMint's `confirm` step — that hold a `money` field. Entity money fields
are unchanged (`entity.defaultCurrency` is already boot-enforced for them),
as are embedded-list money cells (currency at the head, fw#2764) and
`configEdit`, which keeps its plain-number contract.
Add a `currency` to each money field in such a screen's `fields` map:
`currency: { kind: "literal", code: "EUR" }` for one fixed currency, or
`currency: { kind: "tenant" }` for the tenant's own currency.
A `literal` code must be in the app's `currencies` list (`createApp({ currencies })`,
which already includes the defaults). A `tenant`-declared field resolves through
the tenant-settings bundle and holds the form until the value has landed, so that
bundle has to be mounted. Missing declarations fail at compile time; an untyped
caller fails at boot with the screen and field name in the message.

### rate-limiting

**`rate-limiting:query:status` only peeks buckets of the calling tenant (fw#3076)**

The handler took an arbitrary bucket key and peeked it, so a tenant Admin who knew or guessed another tenant's key could read that bucket's counter. The key is now matched segment-exact against the caller: `tenant:`/`tenant+handler:` must carry the caller's own tenant id, `user:`/`user+handler:` the caller's own user id. Everything else — other tenants, other users, the global `ip:`, `l1:` and `l2:` middleware buckets, malformed keys — is `access_denied` (`bucket_outside_tenant`) unless the caller is SystemAdmin, whose access is unchanged. The check runs before the resolver-wiring check, so a denied caller learns nothing about the mount either.

**Migration:** Only affects non-SystemAdmin callers of `rate-limiting:query:status`. A tenant
Admin keeps `tenant:<own>`, `tenant+handler:<own>:<handler>`, `user:<self>` and
`user+handler:<self>:<handler>`. Two reads it had before now need SystemAdmin:
another user's bucket inside the same tenant (the tenant is not part of a
`user:` key, so it cannot be verified without a membership lookup) and the
global `ip:`/`l1:`/`l2:` buckets, which are not tenant-owned. Ops tooling that
peeks those from a tenant Admin session has to run as SystemAdmin.

## 0.289.0

### framework-core

**appendProvenanceEvent enforces event.tenantId === db.tenantId**

`appendProvenanceEvent(db, event)` checked the event type namespace but wrote `event.tenantId` unverified while granting itself the framework-fixed unsafeRaw reason internally. Since `createLLMProviderForTenant(ctx, tenantId, …)` takes the tenantId as an argument, that made the entry point a cross-tenant write door with no escapeHatch declaration behind it.
The check now runs after `unsafeRawForDeclaredStep` — so a holder not built by `createTenantDb` still fails closed with `InternalError` first — and before the savepoint, so a rejected append leaves no row. It is unconditional, including `mode: "system"`: `crossTenantRebinders` keeps the original tenantId and only flips the mode, so a system-scoped db must not append provenance for a foreign tenant either.
`appendProvenanceEvent` deliberately keeps `withUnsafeRawGrant` + `unsafeRawForDeclaredStep` instead of resolving the runner through the ungated `tenantDbRunner`, because that grant path is the choke point the member-read lock in kumiko-framework#2927 hooks into.

**Migration:** appendProvenanceEvent rejects with AccessDeniedError when event.tenantId does not match the tenantId of the passed TenantDb. Provenance for a foreign tenant has no path left through this entry point — a caller that needs it declares its own escapeHatch path instead. Blast radius checked: every known call site in kumiko-enterprise passes event.user.tenantId through, so no call site changes.

**Boot fails when an anonymous-accessible handler declares no rateLimit**

validateAnonymousRateLimit (packages/framework/src/engine/boot-validator/entity-handler.ts) previously returned early when a handler declared no rateLimit at all, so an anonymous, internet-facing handler with zero throttling passed boot silently while one with a merely wrong bucket (rateLimit.per="user") was rejected. The check now runs for every handler whose access.roles includes "anonymous": it still skips openToAll handlers (they never admit anonymous) and rateLimit: { disabled: true, reason } declarations, but a handler with access.roles including "anonymous" and no rateLimit at all now throws at boot, naming the handler.

**Migration:** Every handler whose access.roles includes "anonymous" needs a rateLimit declaration: either rateLimit: { per: "ip" | "ip+handler", limit, windowSeconds } (per must not be "user"/"user+handler" — anonymous callers share user.id="anonymous", so a user-keyed bucket is a single global tap), or the documented exception rateLimit: { disabled: true, reason: "..." } for a handler that must not be rate-limited. This PR fixes the eight bundled-features handlers that tripped this at authoring time: compliance-profiles:query:sub-processors, template-resolver:query:by-slug, template-resolver:query:by-tenant, managed-pages:query:by-slug, managed-pages:query:by-tenant-published, managed-pages:query:branding, auth-email-password:query:signup-registration-status, seo:query:config.

**ctx.db.unsafeRaw is denied under ctx.queryAsMember**

**Migration:** Query handlers reached through ctx.queryAsMember can no longer call ctx.db.unsafeRaw — not even for reads. Move them to the ctx.db query APIs, or stop calling them via queryAsMember. Consequence for kumiko-enterprise: ai-call provenance writes under queryAsMember now fail closed; withProvenance swallows the error and counts provenance_drop_total.

**requiredKeysFromScreen reads section.groups — group field labels and group titles are i18n-required**

`requiredKeysFromScreen` (packages/framework/src/i18n/required-surface-keys.ts) read only `section.fields` in all six `EditFieldsSection` branches (`entityEdit`, `actionForm`, `secretMint` mint + confirm layout, `configEdit`, `projectionDetail`), so a field declared through `section.groups` never reached the required-key set and `groups[].title` was never required at all — while `computeEditViewModel` translates a group title exactly like a section title. `validateI18nSurfaceKeys` therefore let a screen boot with untranslated group field labels and group titles, the one error class that guard exists for.
The new `sectionFieldSpecs` in packages/framework/src/engine/screen-helpers.ts returns the union of `section.fields` and `section.groups[].fields` (a union, unlike the boot-validator's either-or `flattenFieldsOrGroups`, which runs after the fields-XOR-groups check) and is used at all six branches; each branch now also pushes every `groups[].title` alongside `section.title`, honoring the same `treatDotFormAsKey` option. The `writeForm` branch in `projectionDetail` is unchanged — `EditWriteFormSection` has no `groups`.

**Migration:** The i18n boot guard now demands translations it silently skipped before. An app whose entityEdit/actionForm/secretMint/configEdit/projectionDetail screens declare fields through `layout.sections[].groups` can newly fail boot with `required translation key missing: "<feature>:entity:<entity>:field:<name>"`. Add the missing field-label keys (or a `fieldLabels` override, where that screen type supports one) for every field declared under `groups[].fields`. Colon-form `groups[].title` values are now required too — add the key, or keep the title as literal display text (no colon, no `i18nKey()`) if it is not meant to be translated. Dot-form group titles behave exactly like dot-form section titles: only required when the caller passes `treatDotFormAsKey`.

## 0.281.0

### framework-core

**declareEscapeHatch is a new export from @cosmicdrift/kumiko-framework/engine**

**Migration:** A standalone helper that escalates (`unsafeRaw`, or `queryAs`/`writeAs` with a
system identity) on a `HandlerContext` handed to it by its caller — rather than
baselining the Escape-Hatch-Declared Guard finding — declares it at the call
site instead: `declareEscapeHatch({ reason: "..." })` as the first statement of
the helper's body, describing what is escalated and on whose right (the caller's
handler still carries its own `escapeHatch` declaration). The reason must be a
string literal and not a placeholder (see the guard's generic-reason check) —
there is no boot validator behind this form to catch an empty or vague one.

**withUnsafeRawGrant is no longer exported from @cosmicdrift/kumiko-framework/db**

**Migration:** A consumer that imported `withUnsafeRawGrant` from `@cosmicdrift/kumiko-framework/db` to grant itself `unsafeRaw` access declares `escapeHatch: { reason: "<why>" }` on the relevant registration (handler, hook, or `r.useExtension(...)`) instead, then fetches the runner with `ctx.db.unsafeRaw("<same reason>")`. No blast radius found outside the framework itself: no app repo, kumiko-platform, kumiko-studio, or kumiko-enterprise code used this symbol.

## 0.280.0

### framework-core

**TenantDataHookCtx/UserDataHookCtx.db is a tenant-filtered TenantDb; unfiltered hook access needs r.useExtension({ escapeHatch }) (fw#2914 Zugang 3).**

EXT_TENANT_DATA `destroy` hooks (`TenantDataHookCtx.db`) and EXT_USER_DATA `export`/`delete` hooks (`UserDataHookCtx.db`) no longer receive the unfiltered `DbRunner` that was bound to the extension's owning handler. Both are now a `TenantDb` in "tenant" mode, built via the public `createTenantDb(...)`, bound to the hook's `tenantId`: reads/writes go through `ctx.db.selectMany/fetchOne/insertOne/updateMany/deleteMany`, already scoped to that tenant plus `SYSTEM_TENANT_ID` reference rows. `r.useExtension(EXT_USER_DATA | EXT_TENANT_DATA, entityName, { ... })` gains an `escapeHatch?: { reason: string }` option, validated non-empty at registration time (throws at boot for an empty/whitespace reason). Declaring it grants `ctx.db.unsafeRaw(reason)` inside that entity's hooks — same reason string — which returns the real, unfiltered `DbRunner`; without it, `ctx.db.unsafeRaw(reason)` throws `AccessDeniedError`. Every granted use reports an `"unsafe-raw"` escape-hatch audit event (`{ handler: "userData:<entity>"|"tenantData:<entity>", kind, reason, tenantId, actor }`) through the caller's `_escapeHatchAuditSink` when wired, else a `security:escape-hatch-used` warn-log — same #2861 pattern PR #2934 already applied to the job runner, and the same one fw#2914's earlier JobContext.db and read-step changes already applied elsewhere in the framework. `run-forget-cleanup.ts`/`run-user-export.ts` (user-data-rights) thread `escapeHatchAuditSink`/`actor` from their owning `r.job`'s `ctx._escapeHatchAuditSink`/`ctx.systemUser.id` down to each hook's `TenantDb`, so a declared use is attributed to the real job run, not `"<unattributed>"`.
`asRawClient(ctx.db)` inside a hook now throws immediately: `asRawClient` rejects a `TenantDb`-shaped argument ("received a tenant-scoped TenantDb (ctx.db). Raw SQL helpers do not apply the tenant filter — use a ctx.db.<method>, or ctx.db.unsafeRaw(reason) with escapeHatch: { reason } ..."). The framework's `DbRunner`-typed free functions (`selectMany(db, table, where)`, `fetchOne`, `insertOne`, `updateMany`, `deleteMany`, `createTenantDb(db, tenantId, mode)`, etc. from `@cosmicdrift/kumiko-framework/bun-db`/`/db`) now reject `ctx.db` as their first argument at compile time too — `TenantDb` does not structurally satisfy `DbRunner` (no `.unsafe`/`.begin`).
A table built via `createEntity`+`buildEntityTable`+`r.entity(...)` carries the pre-existing `EXECUTOR_ONLY` brand, so `ctx.db.insertOne/updateMany/deleteMany(table, ...)` against it is a compile error by design ("a managed projection is only writable through the executor"); a hook that needs to write such a table directly (bulk hard-delete, jsonb key removal, an UPDATE expression `updateMany`'s literal-value `set` can't express) needs the `escapeHatch` + `ctx.db.unsafeRaw(reason)` route, filtering by tenant/owner in the SQL text itself — the escape hatch removes automatic tenant-filtering, not the hook author's responsibility to filter. A table built via `defineUnmanagedTable` carries no such brand and stays writable through `ctx.db`'s typed methods directly.
This PR's own `custom-fields` user-data-rights wiring (`wire-user-data-rights.ts`) uses the escape hatch for exactly this reason: `selectCustomFieldsHostRows` runs against a dynamic host table name unknown at compile time, so it can't use `ctx.db`'s typed methods. CI's `AST-Guards (shared runner)` step (`@cosmicdriftgamestudio/kumiko-guards@^0.36.0`, pinned) does not yet recognize this call shape — `isEscapeHatchDeclaredFunction` in `guard-escape-hatch-declared.ts` only matches a property/method literally named `handler`, or a direct call to `hook`/`writeHandler`/`queryHandler`/`streamHandler`; `r.useExtension(EXT_USER_DATA, entityName, { export: exportHook, escapeHatch })` matches neither, because `useExtension` isn't in `ESCAPE_HATCH_CALL_METHODS` and the hook property here is `export`/`delete`, never `handler`. This also isn't fixable by baselining from kumiko-framework: `security-baselines/<repo>.json` ships inside the pinned `@cosmicdriftgamestudio/kumiko-guards` npm package itself, and `run-guards.ts`'s own comment states it is rewritten only by "the infra baseline-maintenance run over all repos on main" — never by a consuming repo's local run, and never persisted through a consuming repo's `bun install`. The fix belongs in the guard's owning repo (presumably `infra`, per this workspace's root `CLAUDE.md`): add `useExtension` to `ESCAPE_HATCH_CALL_METHODS`, or otherwise recognize the framework's actual hook-property names (`export`/`delete`/`destroy`), then release a new `@cosmicdriftgamestudio/kumiko-guards` version and bump the range in kumiko-framework's `package.json`. Until that lands, this PR's `AST-Guards (shared runner)` CI check stays red on this one finding; every other check is green.

**Migration:** A hook that only reads/writes its own tenant through `ctx.db` method calls (`ctx.db.selectMany/fetchOne/insertOne/updateMany/deleteMany`) needs no change — it now gets the same tenant filter every other `TenantDb` consumer already had. A hook that treated `ctx.db` as a raw connection (`asRawClient(ctx.db)`, `ctx.db` passed as the first argument to a free-function `selectMany`/`fetchOne`/`insertOne`/`updateMany`/`deleteMany`/`createTenantDb`, a cast to `DbRunner`/`DbConnection`, or `"raw" in db ? db.raw : db`) must add `escapeHatch: { reason: "<why>" }` to its `r.useExtension(EXT_USER_DATA | EXT_TENANT_DATA, entityName, { ... })` registration and fetch the runner explicitly with `ctx.db.unsafeRaw("<why>")` (same reason string) at the point of use. Prefer converting to `ctx.db`'s typed methods first — reach for `unsafeRaw` only when the target table is `EXECUTOR_ONLY`-branded (a managed `r.entity(...)` table; typed writes reject it by design — see the `EXECUTOR_ONLY`/`WritableTable` note in Detail) or the SQL needs an expression the typed API can't produce (e.g. a jsonb `-` key-removal `UPDATE`). No codemod — cross-hook raw-SQL usage is expected to be rare enough, and tenant-filter-relevant enough, to review by hand per hook. Hand-built `TenantDataHookCtx`/`UserDataHookCtx` objects in tests need `db: createTenantDb(conn, tenantId, "tenant", undefined, undefined, undefined, { unsafeRaw: { reason: "<why>" } })` instead of a plain connection.

Audit at release — kumiko-enterprise, 7 files across 5 packages, none touched by this PR (out of scope; must be migrated in kumiko-enterprise itself before it bumps its pinned `@cosmicdrift/kumiko-framework`/`@cosmicdrift/kumiko-types` version, or `tsc` fails):
- `packages/kumiko-credit/src/hooks/userdata-hook-shared.ts` (`forgetMatchingRows`/`anonymizeMatchingRows`, shared by bauspar + credit's delete hooks): `createTenantDb(ctx.db, ctx.tenantId, "system")` and `selectMany(ctx.db, table, where)` both take `ctx.db` as a raw-`DbRunner`-typed argument — needs `escapeHatch` on both entities' `r.useExtension(...)` plus `createTenantDb(ctx.db.unsafeRaw("<why>"), ctx.tenantId, "system")`; the `selectMany` call can drop the free-function form entirely and become `ctx.db.selectMany(table, where)` (already tenant-scoped to `ctx.tenantId`, no need for "system" mode there).
- `packages/kumiko-credit/src/hooks/bauspar.userdata-hook.ts` and `.../credit.userdata-hook.ts`: each has its own inline `selectMany(ctx.db, table, { ... })` (export hook) — same fix, `ctx.db.selectMany(table, { ... })`.
- `packages/ai-agent/src/hooks/ai-agent-turn.userdata-hook.ts`, `packages/ai-conversation/src/hooks/designer-conversation-turn.userdata-hook.ts`, `packages/pattern-storage/src/hooks/pattern-file.userdata-hook.ts`, `packages/prompt-store/src/hooks/prompt-template-version.userdata-hook.ts`: each has the same `createTenantDb(ctx.db, ctx.tenantId, "system")` + two `selectMany(ctx.db, table, { ... })` inline pair as `userdata-hook-shared.ts` above — same fix per file.

`packages/ai-foundation/src/providers/provenance.ts` (`recordAiCall`) and `packages/ai-pipeline/src/steps/shared.ts` (`recordStepProvenance`) were checked and need NO change: neither registers an EXT_USER_DATA/EXT_TENANT_DATA hook (they run off `HandlerContext`/`WorkflowPipelineCtx`, unrelated to this PR — that context's `.db` was already `TenantDb` from an earlier fw#2914 change), and both already use exactly the pattern this PR expects from hooks too: `withUnsafeRawGrant(ctx.dbOutsideTransaction ?? ctx.db, { reason: PROVENANCE_UNSAFE_RAW_REASON }).unsafeRaw(reason)`.

Guard-version gap: once each of these 7 files declares `escapeHatch` on its `r.useExtension(...)` registration, expect the same `AST-Guards (shared runner)` failure this PR hits on `wire-user-data-rights.ts` (see Detail above) — the currently-pinned `@cosmicdriftgamestudio/kumiko-guards@^0.36.0` doesn't recognize `escapeHatch` on a `useExtension` call. That guard bump has to land (and kumiko-enterprise's pinned guards range has to move) before or alongside this migration, not after.

## 0.278.0

### cap-counter

**createStockCapGuard/checkStockCap/withStockCap resolve through the caller's TenantDb, not a raw DbRunner + explicit tenantId (fw#2854).**

`createStockCapGuard`'s resolver is now `(db: TenantDb) => Promise<TCaps>` instead of `(db: DbRunner, tenantId: TenantId) => Promise<TCaps>`. `checkStockCap(db: TenantDb, spec)` drops the separate `tenantId` parameter — the tenant comes from `db.tenantId`, and the count runs through `TenantDb.count` instead of the raw `countWhere`. `StockCapSpec.table` is now typed `SchemaTable | EntityTableMeta` (matching `TenantDb.count`'s table parameter) instead of `Parameters<typeof countWhere>[1]`. `withStockCap` no longer declares an `escapeHatch` on the wrapped handler and no longer reads through `ctx.db.unsafeRaw(...)` — it calls `checkStockCap(ctx.db, spec)` directly, so a `TenantAdmin`-only handler with no `escapeHatch` can use it.

**Migration:** `createStockCapGuard(async (db, tenantId) => ...)` → `createStockCapGuard(async (db) => ...)`, reading `db.tenantId` instead of the removed second argument. A direct `checkStockCap(runner, tenantId, spec)` call → `checkStockCap(tenantDb, spec)` with a `TenantDb` built via `createTenantDb(runner, tenantId)` (or `ctx.db` inside a handler). If your wrapped handler relied on `withStockCap`'s auto-added `escapeHatch` for some other reason, declare it explicitly on the handler instead — `withStockCap` no longer adds one.

### tier-engine

**createTierResolver's resolveTier/resolveTierCaps take only a TenantDb — no separate tenantId argument (fw#2854).**

`resolveTier(db)` and `resolveTierCaps(db)` (from `createTierResolver`) now read the tenant from `db.tenantId` instead of taking a second `tenantId` parameter, so a caller can no longer pass a `TenantDb` for one tenant alongside a different `tenantId` and resolve a foreign tenant's tier.

**Migration:** `resolveTier(ctx.db.raw|runner, tenantId)` → `resolveTier(ctx.db)` (same for `resolveTierCaps`). Outside a handler: `resolveTier(createTenantDb(runner, tenantId))`.

## 0.275.0

### files-tenant-data

**sweepOrphanedDerivativesJob takes the raw DbConnection as a third argument; the job declares escapeHatch (fw#2914).**

JobContext.db is now a tenant-filtered TenantDb. The sweep checks fileRef owners of every tenant, so its registration declares `escapeHatch` and passes `ctx.db.unsafeRaw(reason)` to `sweepOrphanedDerivativesJob(payload, ctx, db)`. Without the raw runner, the foreign-tenant owner lookup would be narrowed away and every derivative would look orphaned.

**Migration:** Direct callers of the exported `sweepOrphanedDerivativesJob` pass the raw `DbConnection` as the third argument. Apps that only mount the feature need no change.

### framework-core

**JobContext.db is a tenant-filtered TenantDb; unfiltered job access needs r.job({ escapeHatch }) or r.systemScope() (fw#2914).**

Job handlers no longer receive the unfiltered boot `DbConnection` as `ctx.db`. `JobContext.db` is now a `TenantDb` in "tenant" mode, bound to the job's resolved tenant (`_tenantId`, `payload.tenantId`, or `SYSTEM_TENANT_ID` for tenant-less cron jobs). Reads see that tenant plus `SYSTEM_TENANT_ID` reference rows, and writes are scoped to it. `JobDefinition` gains `escapeHatch?: { reason }`: it grants `ctx.db.unsafeRaw(reason)` for that job and reports an `"unsafe-raw"` escape-hatch audit event through `_escapeHatchAuditSink` (deduplicated like handler grants). Without it, `ctx.db.unsafeRaw` throws `AccessDeniedError`. `r.systemScope()` features keep `ctx.systemDb` unchanged. `r.job` throws at registration for an `escapeHatch` with an empty reason. Framework `soft-delete` cleanup jobs run on the tenant-filtered `TenantDb` without a grant. Bundled cross-tenant jobs now declare `escapeHatch`: auth-mfa reencrypt, sessions cleanup, form-draft cleanup, secrets rotate, files-tenant-data sweep-orphaned-derivatives, data-retention retention-cleanup, inbound-mail-retention, tenant-lifecycle run-tenant-destruction, and user-data-rights run-export-jobs/run-forget-cleanup. The systemScope features config, jobs and workflow-runner use `ctx.systemDb.unsafeRaw`. The exported `rotateJob` (secrets) and `sweepOrphanedDerivativesJob` (files-tenant-data) take the raw `DbConnection` as a third argument.

**Migration:** Jobs that only read and write their own tenant through `ctx.db` method calls or `selectMany/fetchOne/insertOne/updateMany/deleteMany(ctx.db, ...)` need no change. A job that treated `ctx.db` as a `DbConnection` (casts, `asRawClient`, `countWhere`, `upsert*`, `incrementCounter`, `createTenantDb(ctx.db, ...)`, `runProjectionsForEvent(..., ctx.db)`, or `"raw" in db ? db.raw : db`) must declare the grant and fetch the runner explicitly. Use `r.job({ name, trigger, escapeHatch: { reason: "<why>" }, handler: async (payload, ctx) => work(ctx.db.unsafeRaw("<why>")) })`; keep the `unsafeRaw` call inside the inline `handler` next to `escapeHatch` so `guard-escape-hatch-declared` recognizes the declaration. `r.systemScope()` features use `ctx.systemDb.unsafeRaw(reason)` instead. WARNING: a job that is not migrated but passes a foreign `where.tenantId` through `ctx.db` does not fail; the filter silently narrows it to the job's own tenant (`SYSTEM_TENANT_ID` for tenant-less cron jobs), so cross-tenant sweeps silently read nothing. Audit every cross-tenant job. Hand-built `JobContext` objects in tests need `db: createTenantDb(conn, tenantId)` (plus `systemDb` for systemScope jobs). Direct callers of `rotateJob`/`sweepOrphanedDerivativesJob` pass the raw connection as the third argument.

### secrets

**rotateJob takes the raw DbConnection as a third argument; the rotate job declares escapeHatch (fw#2914).**

JobContext.db is now a tenant-filtered TenantDb. Rotation re-encrypts every tenant's secrets, so the `rotate` registration declares `escapeHatch` and passes `ctx.db.unsafeRaw(reason)` to `rotateJob(payload, ctx, db)`.

**Migration:** Direct callers of the exported `rotateJob` pass the raw `DbConnection` as the third argument. Apps that only mount the feature need no change.

## 0.274.0

### framework-core

**A searchable reference field targeting an encrypted/PII labelField now fails boot unless that label is itself searchable.**

A searchable reference field can now match a search term against a target row's label even when that label is encrypted or personal data — the match runs through the target entity's own search index instead of the plain-text lookup used for a readable label, which could never match ciphertext and always returned zero matches. As with the plain-text lookup, an unusually large number of index matches drops the match clause instead of silently returning an incomplete page. A matched target row is also checked against the target entity's own read access for the current user, so a match can never surface a row the user could not otherwise see.

**Migration:** A searchable reference field whose target label is encrypted or personal data, but is not itself marked searchable (with fuzzy matching enabled if it also carries a personal-data annotation), now fails to boot instead of silently never matching at request time. Mark the target's label field searchable — with fuzzy matching if it holds personal data, so it is indexed for search — or remove the searchable flag from the reference field if the label was never meant to be searched.

## 0.272.0

### framework-core

**r.step.read.findOne/read.findMany now tenant-filter by default; cross-tenant reads need unsafeAllTenants + escapeHatch (fw#2914).**

`r.step.read.findOne`/`r.step.read.findMany` no longer read through the raw `DbRunner` bound to `ctx.db` (`tenantDbRunner(ctx.db)`, which bypassed every tenant filter). They now call `selectMany(ctx.db, table, where, opts)` — `ctx.db` is a `TenantDb`, so the same `TenantDb.selectMany` tenant filter that `ctx.db` method-form reads already apply now also applies here: own tenant + `SYSTEM_TENANT_ID` reference rows, and a caller-supplied `where.tenantId` outside that scope is narrowed away instead of passed through. Both steps gain an optional `unsafeAllTenants: { reason: string }` argument; when set, the step reads through `ctx.systemDb.unsafeRaw(reason)` (`r.systemScope()` features, already granted by the feature's own systemScope) or `ctx.db.unsafeRaw(reason)` otherwise — the latter throws `AccessDeniedError` unless the write/query handler declares `escapeHatch: { reason }` — and reports an `"unsafe-raw"` escape-hatch audit event, same as any other `ctx.db.unsafeRaw` use. Inside an `r.systemScope()` handler `ctx.db` stays a fail-closed guard, so a read step there without `unsafeAllTenants` still throws `InternalError` (the message now points at `ctx.systemDb`).

**Migration:** No change needed for a read step that only ever reads within the caller's own tenant — it now gets the same tenant filter `ctx.db` method-form reads already had, and a `where.tenantId` for a foreign tenant is silently narrowed to the caller's own scope instead of leaking rows. A read step that intentionally reads across tenants must add `unsafeAllTenants: { reason: "<why the tenant filter cannot apply>" }` to the step AND `escapeHatch: { reason }` (same reason) to the owning write/query handler (or run the step inside an `r.systemScope()` feature, where the grant already exists). No codemod — cross-tenant read-step usage is expected to be rare and needs a real reason per call site.

**ctx.queryAsMember runs the queried handler inside a Postgres READ ONLY transaction — ctx.db and ctx.db.unsafeRaw writes fail (fw#2902).**

`executeQuery` (`pipeline/dispatch-query.ts`) runs every query whose SessionUser has `origin: "member-resolution"` through `runInMemberReadOnlyTransaction` (`pipeline/member-read-only-transaction.ts`): the handler context, the handler, its postQuery hooks and the field-read filter execute inside a savepoint whose first statement is `SET TRANSACTION READ ONLY`. The savepoint is always rolled back — a released one would leave the caller's transaction read-only. With a caller transaction (write handler, in-transaction hook) the savepoint nests into it; without one (query handler, job, `dispatcher.createMemberReader`) the framework opens a pool transaction around the savepoint, holding one connection for the handler's runtime — nested queries' feature/trial gates and rate limits still use their own resolvers, so many concurrent member reads need pool headroom. Inside the subtransaction Postgres rejects switching back via `SET TRANSACTION READ WRITE` (SQLSTATE 25001). Nested `ctx.query` calls inherit the read-only handle; `ctx.queryAs` is now denied for a resolved member principal like the other identity switches (`member_resolution_read_only`), so it cannot reach a context with a writable `dbOutsideTransaction`. Every write — `ctx.db.insertOne`/`updateMany`/`deleteMany`, `ctx.db.unsafeRaw(...)` SQL, `SELECT ... FOR UPDATE/SHARE`, `nextval()`, temp tables — fails with SQLSTATE 25006, surfaced as `AccessDeniedError` (`details.reason` `member_resolution_read_only`, the PG error as `cause`). Feature gate, rate limit, access check and payload validation still run before the transaction opens; membership, principal and auth-claims resolution keep running on the root connection outside it. Handler code that deliberately issues transaction control (`COMMIT`, `RELEASE SAVEPOINT`, `SET SESSION CHARACTERISTICS`) through `unsafeRaw` is not covered — `unsafeRaw` already requires an `escapeHatch` declaration. Top-level `dispatcher.query` and HTTP queries of ordinary users are unchanged.

**Migration:** Find query handlers reached via `ctx.queryAsMember(userId, qn, ...)` (including handlers they call with `ctx.query`) and check them for database side effects: `ctx.db` inserts/updates/deletes, write SQL through `ctx.db.unsafeRaw`, row locks, sequences, temp tables, `ctx.queryAs` calls, or catching a failed statement and continuing (a failed statement now aborts the enclosing transaction). Move such side effects into a write handler called by the original caller, or read the data without writing. Code branching on the raw Postgres error from such a write must branch on `details.reason === "member_resolution_read_only"` instead. Audit at release: bundled-features 0 sites, solon 0, offlot-app 0, money-horse 0, kumiko-enterprise 0 (no consumer calls ctx.queryAsMember yet).

## 0.271.0

### framework-core

**ctx.queryProjection(..., { unsafeAllTenants: true }) needs r.systemScope() or escapeHatch; EntityTableMeta projection tables are now tenant-filtered (fw#2913).**

`ctx.queryProjection(qualifiedName, { unsafeAllTenants: true })` previously lifted the tenant filter for anyone who passed the option, with no declaration required. It now goes through the same gate as `ctx.queryAs`/`ctx.writeAs`/`ctx.queryAsMember` (`pipeline/system-identity-switch.ts`): a new `createGatedProjectionReader(callerLabel, hasGrant, ungated, audit)` wraps the reader `dispatch-shared.ts`'s `buildHandlerContext` builds, and only checks `unsafeAllTenants === true` — a call without that option is never gated. Without a grant it throws `AccessDeniedError` with the new reason `unsafe_all_tenants_denied` (`FrameworkReasons.unsafeAllTenantsDenied`, docs entry in `errors/i18n/{en,de}.yaml`). With a grant — the handler's `r.systemScope()` feature or a declared `escapeHatch: { reason }` — it reports exactly one new `EscapeHatchKind` `"unsafe-all-tenants"` event through the existing escape-hatch audit sink (added to `escapeHatchUsedSchema.kind` in `bundled-features/audit`). Inside a lifecycle hook, `withHookEscapeHatchGrant`/`bindHookEscapeHatchGrant` re-gate `ctx.queryProjection` the same way they already re-gate `queryAs`/`writeAs`/`queryAsMember` — only the hook's own `escapeHatch` grants it, never the enclosing handler's, and (like the identity-switch gate) not even the handler's own `r.systemScope()` feature carries into a hook without its own `escapeHatch`. New internal helpers in `pipeline/system-identity-switch.ts` — `ProjectionReader` (`HandlerContext["queryProjection"]`), `createGatedProjectionReader`, `unsafeAllTenantsDenied` — are not re-exported from `pipeline/index.ts`. `defineProjectionQueryHandler` (`engine/entity-handlers.ts`) gained an `escapeHatch?: EscapeHatchDeclaration` option, forwarded onto the returned `QueryHandlerDef`. Separately, `hasTenantColumn` (`db/tenant-db.ts`, already used by `TenantDb`'s other escape hatches) is now exported from that module — an internal framework/pipeline helper, not re-exported from `db/index.ts` — and `ctx.queryProjection`'s auto-filter uses it instead of reading `projTable["tenantId"]` directly — a projection table built from a plain `EntityTableMeta` (`defineUnmanagedTable`/`deriveEntityTableMeta`, no drizzle `SchemaTable` symbols) has no `tenantId` JS property, so its rows were never tenant-filtered before this fix even though the table has a `tenant_id` column.

**Migration:** A handler or hook that calls `ctx.queryProjection(qualifiedName, { unsafeAllTenants: true })`, or registers `defineProjectionQueryHandler(name, qn, { unsafeAllTenants: true, ... })`, now needs `r.systemScope()` on its feature or `escapeHatch: { reason: "<why this handler needs every tenant's rows>" }` declared on the write/query/stream handler (or on the `r.hook(...)` call, if the read happens inside a hook) — code branching on `details.reason` for the resulting denial must also accept `unsafe_all_tenants_denied`. A hook inside an `r.systemScope()` feature does NOT inherit that grant for `unsafeAllTenants` either (same rule as `ctx.queryAs`/`ctx.writeAs`): it needs its own `escapeHatch: { reason }` on the `r.hook(...)` call. Separately, any projection built from `defineUnmanagedTable`/`deriveEntityTableMeta` (an `EntityTableMeta` with a `tenant_id` column, not wrapped in `table()`'s `SchemaTable`) is now tenant-scoped on every plain `ctx.queryProjection(qualifiedName)` call, where it previously returned every tenant's rows unfiltered. A handler that relied on that bug to read cross-tenant now needs the `unsafeAllTenants: true` opt-in plus a grant, same as above. No codemod — both call sites are rare enough to review by hand.

**systemScope handlers default to a per-tenant+handler rate limit; nested-write refuses a foreign-tenant/foreign-owner parent row (fw#2861).**

`r.systemScope()` write/query/stream handlers that declare no `rateLimit` now default to `{ per: "tenant+handler", limit: 600, windowSeconds: 60 }` — only when `context.rateLimit` is already configured, and never for a SYSTEM-identity caller. `per: "tenant+handler"` (not `"tenant"`) so one hot handler cannot starve every other systemScope handler's shared tenant quota. `RateLimitDeclaration` (`RateLimitOption | RateLimitDisabled`) replaces `RateLimitOption` on `WriteHandlerDef`/`QueryHandlerDef`/`StreamHandlerDef` (and their `*Definition`/inline-options counterparts): `rateLimit: { disabled: true, reason: "..." }` opts a handler out of both the explicit and default limit; the boot validator rejects an empty reason. `enforceRateLimit` (`pipeline/dispatch-shared.ts`) takes a new `isSystemScope: boolean` 5th param; the three dispatch call sites now call it unconditionally. `computeHasRateLimitedHandler`/`wantsL3` stay limited to explicit, non-`disabled` `rateLimit` declarations on purpose. 40 bundled systemScope handlers newly get the default; 7 self-scoped read handlers hit on every page load (traffic scales with signed-in users, not tenant ops) declare `rateLimit: { disabled: true, reason }` instead — `user:query:user:me`, `tenant:query:me`, `config:query:{cascade,values,schema,readiness}`, `delivery:query:preferences` (full per-feature list in the systemscope-rate-limit-nested-ownership changeset). None of the 47 was anonymous-accessible, so no opt-out was required for that reason. Separately, `executeNestedWrite` now refuses to attach nested children to a parent row a custom (non-executor) `:create` handler returned without independently verifying ownership: a new `isForeignTenantParentRow` check refuses a returned row from another tenant (skipped for `r.systemScope()` handlers), and `checkWriteFieldOwnership(parentEntity, parentRow, user)` refuses a same-tenant row whose ownership-bound field does not resolve to the caller — both roll back the whole nested write.

**Migration:** If your app configures a RateLimitResolver (the rate-limiting feature, an explicit `context.rateLimit`, or L1/L2 middleware options that auto-wire one), every `r.systemScope()` write/query/stream handler without its own `rateLimit` is now limited to 600 calls per tenant per handler per 60s for non-SYSTEM callers. Declare an explicit `rateLimit: { per, limit, windowSeconds }` on a handler that legitimately needs more, or `rateLimit: { disabled: true, reason: "..." }` for a per-user self-scoped read whose traffic scales with signed-in users rather than tenant operations (L1 IP limits still apply). Separately, a custom `<entity>:create` handler used under a `nestedWrite: true` relation must return the row it just created for the calling user: returning another tenant's row, or a row whose ownership-bound field(s) do not resolve to the caller, now fails the whole nested write with `access_denied` before any child rows are written.

**`TenantDb.raw` is removed — framework infrastructure gets the connection injected (fw#2860).**

`TenantDb.raw` (`@cosmicdrift/kumiko-types/tenant-db-types`) no longer exists. Framework infrastructure that used to read it — the event-store executor's CRUD verbs, `read.findMany`/`read.findOne`/`unsafeProjectionDelete`/`unsafeProjectionUpsert` engine steps, the entity-convention `crossTenant` handlers, `UncheckedSystemDb.unsafeRaw`, the MSP consumer's per-event `apply()` in `api/server.ts`, and `db/assert-exists-in.ts`'s TenantDb duck-type — now resolves the bound `DbRunner` through a new framework-private module `db/tenant-db-runner.ts` (`bindTenantDbRunner`/`tenantDbRunner`, a `WeakMap<TenantDb, DbRunner>` keyed by the exact object `createTenantDb` built; not re-exported from `db/index.ts` or any package-exports entry, so feature code cannot import it). `asRawClient` (`bun-db/query.ts`) no longer unwraps a `.raw`-shaped TenantDb; it throws when handed one, same as the raw-SQL helpers built on it (`countWhere`, `transaction`, `runInSavepoint`/`runInSavepointIfSupported`, `executeRawQuery`/`executeRawQueryRead`, `upsertOnConflict`, `incrementCounter`, `insertMany`, `deleteManyBatched`) — they no longer accept a `TenantDb` at all. `tenantDbDelegate`'s TenantDb duck-type check no longer looks for `.raw`. `pipeline/projections-runner.ts`'s `runProjections(result, registry, runner)` takes an explicitly-resolved `DbRunner | undefined` (the dispatcher's `resolveDbSource(ctx, tx)`, threaded through `runLifecycle`) instead of reaching into `ctx.db.raw` / `ctx.systemDb.acknowledgeCrossTenant(...).raw` itself; it throws `InternalError` if `result.event` is set but no runner was resolved. `bundled-features/tenant/seeding.ts`'s `fireEntityPostSave`'s optional 4th argument changed from a bare `tenantId` to `{ tenantId, db }` — the caller (already holding a legitimately-declared runner) hands it in instead of the helper trying to pull one out of `context.db`. The boot validator now also rejects a `tenancy: "global"` entity whose owning feature does not declare `r.systemScope()` — a convention write on such an entity would otherwise still dispatch in tenant-mode. `packages/bundled-features/src/jobs/handlers/list.query.ts` switched from `ctx.systemDb.acknowledgeCrossTenant(reason)` to `ctx.systemDb.unsafeRaw(reason)` since it calls `countWhere` directly.

**Migration:** `ctx.db.raw` → `ctx.db.global(table)` for `tenancy: "global"` tables, otherwise `ctx.db.unsafeRaw(reason)` with `escapeHatch: { reason }` on the handler/hook; r.systemScope() features `ctx.systemDb.unsafeRaw(reason)`. Raw SQL helpers (countWhere, transaction, runInSavepoint*, executeRawQuery*, upsert*, incrementCounter, insertMany, deleteManyBatched) no longer accept a TenantDb. Hand-built TenantDb objects passed to the EventStoreExecutor must be created via createTenantDb. `tenancy: "global"` entities must live in an r.systemScope() feature. Custom callers of fireEntityPostSave pass `{ tenantId, db }` as 4th argument.

**Boot validator requires every screen to be reachable from the app's nav tree.**

`validateScreens` now rejects a screen that has no own `nav`, no standalone `r.nav()` pointed at it anywhere in the composed feature set, and no resolvable parent list (`listScreenId`, or a rowAction/toolbarAction/drawer navigate target from an `entityList`/`projectionList`, or — for `entityEdit` — a same-entity `entityList`) — unless it declares `dormant: true`. `dormant` (previously only on `CustomScreenDefinition`) is now on every screen type. The resolution logic is the same `resolveNavParentScreen` the renderer's breadcrumb/NavTree already used, moved into `@cosmicdrift/kumiko-framework/engine/screen-helpers.ts` (re-exported through `ui-types`) instead of a second copy, and widened to also recognize toolbarActions and drawer-kind targets, not just entityList rowActions. The check is skipped when the composed feature set registers no nav entries anywhere at all (an isolated feature/recipe/test boot has no nav tree to be orphaned from).

**Migration:** A screen that boots inside an app with at least one nav entry somewhere, but isn't itself reachable, now fails boot with "has no nav entry and no resolvable list". Fix by declaring `listScreenId` (or a rowAction/toolbarAction navigate target from a list screen pointed at it), adding a standalone `r.nav()` for it, or setting `dormant: true` if it's intentionally reachable only via a direct link/redirect or a consuming app's own `r.nav()` (the established pattern for app-placed settings-area screens like `tenant-list`/`user-list`/`tier-admin`/personal-access-tokens' list/`profile`, now applied consistently across bundled-features).

## 0.269.0

### framework-core

**`openToAll: true` is removed — every openToAll grant now requires { reason } (fw#2858).**

`OpenToAllAccessRule` (`@cosmicdrift/kumiko-types/handlers`) no longer accepts `true`; only `OpenToAllDeclaration` (`{ reason: string; personalData?: "tenant-members" }`) satisfies it, so `{ openToAll: true }` no longer type-checks. `isOpenToAllGranted` denies `true` from untyped sources (pattern JSON, Designer) the same way it already denied a malformed object — a bare `true` reaching it now returns `false` instead of granting access. The boot validator (`engine/boot-validator/access-declarations.ts`) rejects an untyped `openToAll: true` access declaration with an error pointing at `{ reason }` instead of registering the handler. The pattern-library Designer access field (`shared-fields.ts` `accessRuleField`) is now a required text input on `access.openToAll.reason` instead of a boolean toggle, so the Designer can only ever produce the object form. `build-config-feature-schema.ts` synthesizes `{ openToAll: { reason: "config key declares the \"all\" role, so every signed-in user of the tenant may read/write it" } }` for a config key whose roles include `"all"`, instead of `{ openToAll: true }`. `boot-validator/nav.ts` and `renderer-web/app/create-app.tsx` switched from `"openToAll" in access` to `isOpenToAllGranted(access)`, so a malformed or `true` rule is no longer treated as a visible screen/workspace. The feature-AST extractor now also extracts `escapeHatch: { reason }` on write/query handlers (`extractors/handlers.ts`) and on `r.hook` options (`extractors/hooks.ts`), round-tripped through render/patch the same way `access`/`rateLimit` already were.

**Migration:** Replace every `openToAll: true` with `openToAll: { reason: "<who may call it and why that is safe without a role>" }`, adding `personalData: "tenant-members"` where the boot validator requires it for a write handler accepting unbound personal data. Pattern-library or Designer-authored JSON that still has `openToAll: true` must be re-saved with a reason before it type-checks or passes boot. `kumiko-upgrade --apply` runs the migrate-open-to-all codemod automatically, rewriting test files to the default reason and listing every non-test site for manual review; run `bun packages/framework/src/scripts/codemod/migrate-open-to-all.ts --test-reason "<text>" <paths>` directly to override the default test reason.

**ctx.queryAs/ctx.writeAs to any identity other than the caller itself need r.systemScope() or escapeHatch (fw#2876).**

The identity-switch gate from fw#2859 now applies to every target, not only SYSTEM (`isSystemIdentitySwitchAllowed` is replaced by `isIdentitySwitchAllowed(caller, asUser, hasGrant)` in `pipeline/system-identity-switch.ts`; `createGatedIdentitySwitch` takes the caller as second argument). Without a grant, `HandlerContext.queryAs`/`writeAs` only accept the caller itself: same `id`, same `tenantId`, same `origin`, equal `claims`, and roles that are a subset of the caller's roles (`sid`, `pat`, `timezone`, `locale` may differ). Any other target — a different user id, a different tenant, extra roles, changed claims, a stripped `origin` — throws `AccessDeniedError` (code `access_denied`, `details.reason` `identity_switch_denied`, no target id/tenant in the error); SYSTEM targets keep `system_identity_switch_denied`. The grant is the same as before: the calling handler's `r.systemScope()` feature or `escapeHatch: { reason }` on the write/query/stream handler, or the hook's own `r.hook(..., { escapeHatch })`. It stays non-transitive, hooks never inherit it, extension hooks and `r.authClaims` hooks have no declaration site (their `queryAs` only reaches the caller itself), and a hook's caller is taken from the dispatcher-built gate, never from `ctx.user`. `JobContext.queryAs`/`writeAs`, top-level `dispatcher.write`/`query`, `ctx.queryAsMember` and `ctx.resolveActiveMembership` are unchanged. `r.step.callFeature({ as })` goes through the gated `ctx.writeAs` and needs the handler's `escapeHatch` for a foreign `as`.

**Migration:** Find every `ctx.queryAs(user, ...)`/`ctx.writeAs(user, ...)` (also via helpers that receive `ctx`, and `r.step.callFeature({ as })`) whose user is not `createSystemUser(...)`. If the user is `event.user`/`query.user` or a copy with fewer roles, nothing to do. If it is another user, another tenant (e.g. `{ ...event.user, tenantId: other }`) or adds roles, declare `escapeHatch: { reason: "<why this handler acts as that identity>" }` on the write, query or stream handler (or on the `r.hook(...)` call), move the call into an `r.systemScope()` feature or a job, or use `ctx.queryAsMember(userId, ...)` for reads as a stored tenant member. Code branching on `details.reason` for these denials must also accept `identity_switch_denied`. Audit at release: bundled-features 0 sites, solon 0, offlot-app 0, kumiko-enterprise 0 (ai-agent tool dispatcher passes the caller itself).

## 0.267.0

### framework-core

**ctx.db.unsafeRaw(reason) gated by escapeHatch, tenancy: "global" invariants, bundled features migrated off ctx.db.raw (fw#2858).**

`TenantDb.unsafeRaw(reason)` returns the unfiltered `DbRunner` only when the calling write or query handler declares `escapeHatch: { reason }` (lifecycle hooks: `r.hook(..., { escapeHatch })`; a hook no longer inherits the handler's grant, same as the #2859 SYSTEM identity-switch gate). Without a declaration it throws `AccessDeniedError`; an empty reason throws `Error`. `r.systemScope()` features keep using `ctx.systemDb.unsafeRaw(reason)`. `TenantDb.raw` stays deprecated until fw#2860. `createTenantDb`'s 7th parameter changed from an `EscapeHatchDeclaration` to `TenantDbGrants` `{ globalWrites?, unsafeRaw? }`; `withUnsafeRawGrant(tenantDb, grant)` rebinds the unsafeRaw grant. `bindHookIdentitySwitchGrant`/`withHookIdentitySwitchGrant` are renamed to `bindHookEscapeHatchGrant`/`withHookEscapeHatchGrant`. Global tenancy: a `tenancy: "global"` entity must declare `systemStream: true` (boot validator + executor) and its create/update payloads may not carry a non-SYSTEM `tenantId`; tenant-mode `insertOne` into a global table with a `tenant_id` column and `db.global(table)` writes with a non-SYSTEM `tenantId` are rejected; `defineUnmanagedTable({ tenancy: "global" })` rejects a `tenant_id` column; new `declareGlobalTenancy(table)` declares a plain `table()` store without `tenant_id` as global. Bundled features: `userEntity` is `tenancy: "global"`, `store_global_feature_state` is declared global, and every bundled `ctx.db.raw` call site now uses `ctx.db.global(table)`, a filtered `ctx.db` method, or `ctx.db.unsafeRaw(reason)` with an `escapeHatch` on the handler. Handlers that call the auth-mfa `mfaStatusChecker`/MFA code verifier callbacks, handlers wrapped by cap-counter `withStockCap` (declares it automatically) and callers of the custom-fields quota/field-access query helpers now need that declaration.

**Migration:** Replace each `ctx.db.raw` use: reads of a `tenancy: "global"` table → `ctx.db.global(table).selectMany/fetchOne(...)`; reads/inserts whose where/values only use the caller's own tenantId → `ctx.db.selectMany/fetchOne/insertOne(table, ...)` (method form); everything else → `ctx.db.unsafeRaw("<what is read/written and why the tenant filter cannot apply>")` plus `escapeHatch: { reason }` on the write/query handler definition or in the `r.hook` options. Generic reasons (todo, legacy, migration) fail infra#788. `kumiko-upgrade --apply` runs the migrate-db-raw codemod automatically, rewriting the global-table and own-tenant cases and listing the remaining sites for manual review. Custom handlers calling `mfaStatusChecker`/the MFA code verifier or the custom-fields query helpers must declare `escapeHatch`. Direct `createTenantDb(..., escapeHatch)` calls pass `{ globalWrites: escapeHatch }` (and `unsafeRaw` if needed). Rename imports of `bindHookIdentitySwitchGrant`/`withHookIdentitySwitchGrant`. `defineUnmanagedTable({ tenancy: "global" })` definitions must drop their `tenant_id` column; `tenancy: "global"` entities must add `systemStream: true`.

## 0.266.0

### framework-core

**`publicIntake` is removed; an openToAll write handler declares unbound personal data with `openToAll: { reason, personalData: "tenant-members" }`.**

`OpenToAllAccessRule.publicIntake` (`@cosmicdrift/kumiko-types/handlers`) no longer exists. `OpenToAllDeclaration` gains `personalData?: OpenToAllPersonalData`, a named union (currently only `"tenant-members"`, exported from `@cosmicdrift/kumiko-framework/engine` and `/ui-types`): signed-in tenant members may write personal data that no owner rule binds to the caller. The deprecated `openToAll: true` form cannot carry it. `validateAccessDeclarations` requires `personalData: "tenant-members"` for a write handler with `openToAll` whose input accepts a personal-data field that is not owner- or self-bound, rejects `personalData` on query and stream handlers, and rejects any other `personalData` value from untyped sources. `openToAll` never admits anonymous callers, so there is no public-intake value; anonymous personal-data intake is tracked separately. The feature-AST extractor reads `openToAll.personalData` and no longer reads `publicIntake`. Bundled `user:update` now declares `openToAll: { reason, personalData: "tenant-members" }`: `userEntity` has no entity-level `access.write`, and privileged actors may edit any user.

**Migration:** Replace `access: { openToAll: { reason: "..." }, publicIntake: true }` (or `openToAll: true, publicIntake: true`) with `access: { openToAll: { reason: "<why any signed-in tenant member may write this personal data>", personalData: "tenant-members" } }`. Handlers whose personal-data fields are owner- or self-bound through the entity's `access.write` need no declaration. A `publicIntake` key left in an untyped access object (pattern JSON, Designer) is ignored, so the handler fails boot until migrated. No known consumer used `publicIntake`.

**The openToAll personal-data boot check now finds personal-data fields nested anywhere in a write handler's input schema.**

`validateAccessDeclarations` (`engine/boot-validator/access-declarations.ts`) previously compared only the top-level keys of a `z.object` input schema (unwrapping `.optional()`/`.nullable()`/`.default()`) against the handler entity's personal-data fields (pii / userOwned / recordOwned); any other schema shape was skipped. It now collects object keys at every depth via `collectZodObjectKeys` (`engine/boot-validator/zod-shape.ts`): through `z.intersection`, `z.union`/`z.discriminatedUnion`/`z.xor`, `.transform()`/`z.preprocess()`/`.pipe()`/codecs, `.optional()`/`.nullable()`/`.default()`/`.prefault()`/`.nonoptional()`/`.readonly()`/`.catch()`/`z.lazy()`, nested objects (e.g. the update shape `{ id, version, changes: {...} }`), arrays, tuples and records. An update handler that accepted the same personal-data field as its create handler used to pass boot while the create handler failed. A schema with more than 10000 distinct nodes (typically a `z.lazy()` getter that returns a new schema on every call) throws at boot instead of looping. Which entity's fields are compared is unchanged: the handler's mapped entity, or every entity of the feature for an unmapped handler.

**Migration:** A write handler with `openToAll` whose input accepts a personal-data field of its entity inside an intersection, union, pipe/transform, nested object (update `changes`), array or record now fails boot like a top-level field always did. Known: kumiko-enterprise kumiko-credit `update` (intersection) and `bauspar:update` (`changes.name`) under `trustDomain: "tenant"` or with an `access` map that grants any role `"all"`. For each affected handler, bind the entity's rows to the caller (owner-binding entry in this release), restrict `access` to roles, or declare `openToAll: { reason: "...", personalData: "tenant-members" }`.

## 0.263.0

### framework-core

**ctx.queryAs/ctx.writeAs with a SYSTEM identity only from r.systemScope(), jobs, or a handler/hook declaring escapeHatch (fw#2859).**

Switching identity to SYSTEM (a SessionUser whose id is SYSTEM_USER_ID or whose roles contain SYSTEM_ROLE, e.g. `createSystemUser(...)`) through `HandlerContext.queryAs`/`writeAs` now throws `AccessDeniedError` (code `access_denied`, `details.reason` `system_identity_switch_denied`) unless the calling handler belongs to an `r.systemScope()` feature or declares `escapeHatch: { reason }`. The grant is looked up per handler type in the registry and never propagates: a handler reached through another handler's `writeAs(SYSTEM)` needs its own declaration for its own SYSTEM switches. `queryAs`/`writeAs` with a non-system user stays ungated and runs under that user's access. `JobContext.queryAs`/`writeAs` and top-level `dispatcher.write`/`query` (es-ops `systemWriteAs`, extraRoutes) stay ungated. Lifecycle hooks no longer inherit the grant of the handler they fire on: `r.hook(type, target, fn, { escapeHatch })` is the per-hook declaration; hooks contributed through `r.extendsRegistrar` are always denied; `r.authClaims` hooks' `queryAs` denies SYSTEM. `escapeHatch` is now also accepted on query handlers (`QueryHandlerDef`/`QueryHandlerDefinition`/`r.queryHandler` options); the boot validator rejects an empty reason there too, and `r.hook` throws at registration on an empty reason. Static boot-time detection of SYSTEM switches is not possible (handlers are closures), so enforcement is at runtime.

**Migration:** Find every `ctx.queryAs(...)`/`ctx.writeAs(...)` whose user is `createSystemUser(...)` or otherwise carries `SYSTEM_ROLE` (also indirectly through helpers that receive `ctx`). For each, add `escapeHatch: { reason: "<which SYSTEM lookup/write and why the caller's own identity cannot do it>" }` to the write or query handler definition that ends up calling it (`r.writeHandler`/`r.queryHandler` options, `defineWriteHandler`/`defineQueryHandler`), or move the logic into an `r.systemScope()` feature or a job when that is the correct owner. Handlers of `r.systemScope()` features need nothing. A lifecycle hook doing a SYSTEM switch through its runtime HandlerContext passes `{ escapeHatch: { reason } }` as `r.hook`'s options (postSave/postDelete: next to `phase`). `escapeHatch` on a write handler also permits `ctx.db.global()` writes. Consumer call sites to audit at release: solon 15, offlot-app 14, kumiko-enterprise 5 `queryAs`/`writeAs` sites.

**Forms are prefilled from URL query parameters only for fields a declarative `navigate` action declares as `params` (fw#2852).**

`buildAppSchema` now derives `urlPrefillFields` per actionForm/secretMint/entityEdit-create screen from every navigate `params` that targets it — entityList/projectionList rowActions, projectionDetail/entityEdit actions, relatedList rowActions, and projectionDetail metrics; a form nothing targets takes nothing from the URL. Previously any query parameter matching a field name was taken, so a crafted link could seed e.g. an IBAN or e-mail field. Declared params keep working. `sensitive` and `format: "password"` fields are still never prefilled — not from the URL, an allowlist, or a handoff.

**Migration:** Code that prefills a form via `nav.navigate` + `nav.setSearchParams` without a declared `params` (known: publicstatus `custom-field-list`, phronexsis `driver-map-node-panel`, kumiko-enterprise ai-agent `openForm` client tool / `agentPrefill=1`) must switch to a declared `navigate` action with `params`, or — for programmatic prefill — to `useNavigateWithInitialValues()` from `@cosmicdrift/kumiko-renderer`. No codemod.

## 0.261.0

### framework-core

**access is required on handler definitions; openToAll accepts { reason } (+ publicIntake) (fw#2855).**

`WriteHandlerDef`/`QueryHandlerDef`/`StreamHandlerDef`.access (`@cosmicdrift/kumiko-types/handlers`), `WriteHandlerDefinition`/`WriteHandlerInput`/`QueryHandlerDefinition`/`StreamHandlerDefinition`.access, `EntityHandlerOptions.access`, and the `r.writeHandler`/`r.queryHandler`/`r.streamHandler` positional `options` param are now required — a handler with no access rule fails to compile instead of silently registering unreachable (previously the boot-validator caught it at runtime). `registerEntityCrud` throws at registration when an enabled verb resolves no access (`write.access`/`read.access`/`verbAccess.<verb>` all unset) — was previously a boot-validator throw. `AccessRule.openToAll` accepts `{ reason: string }` (plus optional `publicIntake: true`); `true` still compiles (deprecated pre-#2855 form, tracked for removal in fw#2854's call-site migration) but a new boot-validator (`engine/boot-validator/access-declarations.ts`) rejects an empty `openToAll.reason`, an empty `escapeHatch.reason`, `publicIntake` on a query/stream handler, and — the main new catch — a write handler with `openToAll` that accepts a personal-data field (pii/userOwned/recordOwned) in its input schema without `publicIntake: true`. Code that read `access.openToAll` as a boolean must switch to `isOpenToAllGranted(rule)` (`@cosmicdrift/kumiko-types/handlers`, also re-exported from `@cosmicdrift/kumiko-framework/engine` and `/ui-types`), which handles both the `true` and `{ reason }` forms.

**Migration:** Add `access` to every handler definition: `r.writeHandler`/`r.queryHandler`/`r.streamHandler` object- and positional-form options, `defineWriteHandler`/`defineQueryHandler`/`definePagedQueryHandler`/`defineProjectionQueryHandler` options, `defineEntityCreate/Update/Delete/Restore/List/DetailHandler` options, and `registerEntityCrud`'s `write.access`/`read.access` (or per-verb `verbAccess`). Replace `openToAll: true` with `openToAll: { reason: "..." }` going forward — `true` still compiles but is deprecated (fw#2854 tracks the 471-site call-site migration; new code should use the object form). A write handler that already used `openToAll` and accepts a PII field now fails boot unless it also declares `publicIntake: true` (any authenticated user may legitimately submit that data) or is restricted to roles instead. Any code reading `access.openToAll` as a boolean must switch to `isOpenToAllGranted(rule)`.

## 0.259.0

### sessions

**sessions:query:user-session:mine returns the paged envelope { rows, nextCursor }; new self-service my-sessions screen (fw#2844).**

The query backs the new `my-sessions` projectionList (open to every signed-in user): the caller's live sessions with a per-row revoke (hidden on the current session) and "sign out all other devices". Exported id SESSION_MINE_SCREEN_ID. Server-side scoping to the caller is unchanged.

**Migration:** Breaking for direct callers of `sessions:query:user-session:mine`: read `data.rows` instead of treating `data` as the array (`nextCursor` is always null). Account-security custom screens built on this query can be replaced by a dashboard with `kind: "screen"` panels on `sessions:screen:my-sessions` and the auth-mfa screens (money-horse#477, publicstatus#435, kumiko-studio#283).

## 0.241.0

### audit

**AuditLogScreen and AuditLogDetailScreen removed; audit-log/audit-log-detail are now declarative screens (fw#2312).**

`audit-log` and `audit-log-detail` render through the generic renderer (`projectionList`/`projectionDetail`) instead of custom React components — the renderer selects a screen by its `screen.type`, not a client component registry, so `AuditLogScreen`/`AuditLogDetailScreen` were dead exports the moment the screen definitions switched. The `payload`/`metadata` fields now use the `format: "json"` field-renderer (see framework changelog) instead of a raw escaped-string dump.

**Migration:** Breaking only if you imported these components directly (no shipped consumer app did). Remove `import { AuditLogScreen, AuditLogDetailScreen } from "@cosmicdrift/kumiko-bundled-features/audit/web"` and any `components: { AuditLogScreen: ..., AuditLogDetailScreen: ... }` entry in your `auditClient()`/renderer setup — the bundled feature registers its own `audit-log`/`audit-log-detail` screens now, nothing left for an app to wire.

### jobs

**JobRunsScreen and JobRunDetailScreen removed; job-runs/job-run-detail are now declarative screens (fw#2312).**

`job-runs`/`job-run-detail` render through the generic renderer (`projectionList`/`projectionDetail`) instead of custom React components — the renderer selects a screen by its `screen.type`, not a client component registry, so `JobRunsScreen`/`JobRunDetailScreen` were dead exports the moment the screen definitions switched. Job triggering moved from an inline control on the old custom screen to a new `job-trigger` `actionForm`, opened via a `kind: "drawer"` `toolbarAction` on `job-runs`. `job-run-detail`'s `logs` field now uses the `format: "json"` field-renderer (see framework changelog) instead of a raw escaped-string dump.

**Migration:** Breaking only if you imported these components directly (no shipped consumer app did). Remove `import { JobRunsScreen, JobRunDetailScreen } from "@cosmicdrift/kumiko-bundled-features/jobs/web"` and any `components: { JobRunsScreen: ..., JobRunDetailScreen: ... }` entry in your `jobsClient()`/renderer setup — the bundled feature registers its own `job-runs`/`job-run-detail`/`job-trigger` screens now, nothing left for an app to wire.

### tier-engine

**TierAdminScreen removed; tier-admin is now a declarative actionForm (fw#2312).**

`tier-engine:screen:tier-admin` is now a declarative `actionForm` (a `reference` field for the tenant, a `select` field for the tier) instead of a custom React component: it dispatches `set-tenant-tier` directly, so the renderer's generic form handles tenant lookup, validation and submit. Two behaviors are intentionally not carried over: the current tier of the selected tenant is no longer shown before submit (declarative forms have no dependent-query support), and the success state no longer names the newly assigned tier (a generic actionForm success doesn't surface write-response data). Both are visible again after a page reload / re-navigation — the assignment itself is unchanged.

**Migration:** Breaking only if you imported `TierAdminScreen` directly (no shipped consumer app did — all reference the screen by its qualified id `tier-engine:screen:tier-admin`). Remove `import { TierAdminScreen } from "@cosmicdrift/kumiko-bundled-features/tier-engine/web"` and any `components: { TierAdminScreen: ... }` entry in your renderer setup — the bundled feature registers the `tier-admin` screen itself now, nothing left for an app to wire.

### user-data-rights

**privacy-center is now a declarative screen; userDataRightsClient's privacyCenter.showDeletion option is removed (fw#2312).**

`privacy-center` is now a declarative `projectionDetail` screen instead of a custom React component: the Restriction and Deletion sections render through the generic renderer (`EditFieldsSection` + `actions: RowAction[]`), preserving the original confirmation dialogs (`RowActionWriteHandler.confirm`) and visibility rules (`visible: {field, eq/ne}`) 1:1. The Export section (Art. 20) stays a custom `EditExtensionSection` — it needs polling + a signed-URL download — registered via the new `ClientFeatureDefinition.extensionSectionComponents` under `EXPORT_SECTION_EXTENSION_NAME`. `PrivacyCenterScreen` is a dead export (the renderer selects the screen by `screen.type`, not the client component registry). The single `status` field now renders through the `enumOption` format instead of the raw enum string; `gracePeriodEnd` is hidden when no deletion is pending instead of showing an empty date. Known UI regression, accepted for this pass: the confirm-dialog title is now always the action's `label` (the renderer hardcodes this) — the original's distinct `dialogTitle` copy and its dynamic composed banner sentence (e.g. "Your account will be deleted on {date}") are gone, replaced by the translated `status` label plus a separately labeled `gracePeriodEnd` date.

**Migration:** A declarative screen is registered once and can no longer be toggled per-app on the client: `userDataRightsClient(options)`'s `privacyCenter: { showDeletion }` option is removed. Move the flag server-side instead — replace `createUserDataRightsFeature({})` with `createUserDataRightsFeature({ privacyCenterShowDeletion: false })` (default `true`) — it conditionally omits the Deletion section and its `request-deletion`/`cancel-deletion` actions from the screen definition. Then drop the now-unused `privacyCenter` option from the matching `userDataRightsClient({ privacyCenter: { showDeletion: false } })` call. Known affected consumer: `money-horse` (`src/app/client-features.tsx:74`).

### user-profile

**user-profile now registers its own profile screen (id user-profile:screen:profile); app-side profile screen registrations must be removed (fw#2312).**

`profile` is now a declarative `projectionDetail` screen bound to `user:query:user:me` instead of a custom React component: change-password and change-email stay `EditExtensionSection` components (re-auth flows a declarative action can't express), account deletion (request/cancel via `user-data-rights`, grace period) is now fully declarative fields + `actions: RowAction[]`, preserving the original confirm dialog and `visible: {field, eq/ne}` toggle 1:1. `userProfileClient()` now registers the two extension-section components via `extensionSectionComponents` instead of exposing a `ProfileScreen` component for apps to place in a `components` map. `ProfileScreen` is a dead export. New exports: `ChangeEmailSection`, `ChangePasswordSection` (the two surviving extension components, importable for tests but not meant to be placed manually). Known UI regression, accepted for this pass (same trade-off as `privacy-center`): the deletion confirm-dialog title is now always the action's `label`; the dynamically composed grace-period banner sentence is gone, replaced by a plain `gracePeriodEnd` date field; there is no cancel-deletion success toast.

**Migration:** The bundled feature now registers the `profile` screen itself (id `user-profile:screen:profile`) — an app's own `profile` custom-screen registration collides on boot with a duplicate short-id error. Delete the app-side registration entirely: `r.screen({ id: "profile", type: "custom", renderer: { react: { __component: "UserProfileScreen" } }, access: { openToAll: true } })` has no replacement to write, just remove the call. If you have an `r.nav({ screen: "profile" })` (or any other reference to the app-local `profile` screen id), repoint it at `"user-profile:screen:profile"`. Also remove `components: { UserProfileScreen: ProfileScreen }` from your renderer/client setup and the now-unused `ProfileScreen` import — the client no longer exposes that component. Known affected consumers (not modified here, out of this PR's scope): `money-horse` (`src/features/money-horse/feature.ts:286-292`) and `offlot-app` (`src/features/account/feature.ts:24-30`) both currently register their own `profile` custom screen this way.

## 0.235.0

### framework-core

**UnprocessableOpts.details can no longer carry its own `reason` key (fw#2460).**

UnprocessableError builds its `details` as `{ ...opts?.details, reason }`, so `reason` was always owned by the ctor's first positional argument — but nothing stopped a caller from also putting `reason` inside `opts.details`, where it was silently overwritten. `UnprocessableOpts.details` is now typed `Readonly<Record<string, unknown>> & { readonly reason?: never }`, so that redundant key is now a compile-time error (TS2322) instead of a silent no-op. This was shipped in #2460 without a changeset or changelog entry, which is what this entry retroactively fixes.

**Migration:** Remove `reason` from any `details: { ... }` object literal passed to `new UnprocessableError(reason, { details: { ...} })` — the value is unchanged, it now flows only through the first positional argument. Run the codemod, or delete the property by hand where it isn't statically removable (the codemod reports those sites with file:line and a reason).

## 0.209.1

### framework-core

**Job runs no longer go through the event store; read_job_runs table renamed to store_job_runs (fw#2243).**

Job runs (jobRun) no longer go through the event store. Every job execution used to append a run-started + run-completed/run-failed event replayed through two inline projections — in the busiest apps this was ~99% of all events ever written, for data nothing else replays or subscribes to. onJobStart/onJobComplete/onJobFailed now write straight into the (renamed) store_job_runs / store_job_run_logs tables, with a new daily jobs:job:retention-cleanup job (retentionDays, default 30) purging old rows so the tables don't grow forever.

**Migration:** Breaking for raw-SQL consumers: the table is renamed read_job_runs → store_job_runs (store_job_run_logs is unchanged). The migration drops read_job_runs outright — old run history is not preserved, it was operational/debug data, not a system of record. Apps that only use the shipped job-runs-screen/jobs:query:* handlers are unaffected; apps with a raw SQL dependency on read_job_runs need a follow-up on their side.

## 0.202.0

### personal-access-tokens

**personal-access-tokens: `write:create` now requires `currentPassword` (+ `mfaCode` if MFA enrolled) (e91d4cb).**

`personal-access-tokens:write:create` now requires `currentPassword` (verified against the caller's password hash) before minting a token, and rejects when the caller has MFA enrolled and `mfaCode` is missing or wrong — a session cookie alone is no longer enough to stand up a durable API credential. `expiresInDays` now defaults to 90 days instead of never-expiring when omitted (the existing 3650-day cap is unchanged, so a genuinely long-lived token is still possible if requested explicitly). Changing a user's password, or enabling/disabling MFA, now revokes all of that user's live PAT tokens — mirrors the existing session auto-revoke-on-password-change behavior. `run-prod-app`/`run-dev-app` wire the new MFA↔PAT revoke callback automatically when both `auth-mfa` and `personal-access-tokens` are mounted; no app-level change needed for that part.

**Migration:** Apps that already mint PATs (their own client code, scripts, or tests) need to add `currentPassword` to the `create` request payload — this is a breaking change to the `create` request shape despite the minor bump (bundled-features doesn't follow strict semver across its handler schemas yet). If the caller has MFA enrolled, also include a valid `mfaCode`.

## 0.201.0

### framework-core

**IdempotencyGuard.check()/.store() gain a discriminated result + token param on top of the 0.198.0 signature (fw#2139).**

Fixes two idempotency-lock races that could let a duplicate request re-run a write handler or silently overwrite a fresher cached result. `waitTimeoutMs` (how long a duplicate request waits for the in-flight one) is now clamped to always exceed `pendingTtlSeconds` (the in-progress lock's own TTL) — previously the defaults (30s lock vs. 25s wait) let a retry give up and re-execute the handler while the original call was still legitimately running. `IdempotencyGuard.store()` now does an atomic compare-and-swap against the exact lock token the calling run acquired (Redis EVAL) instead of an unconditional SET, so a stale, slow-finishing run can no longer stomp the result a reclaiming run already persisted after the lock expired. `IdempotencyGuard.check()` now returns a discriminated `{ status: "cached", result }` / `{ status: "acquired", token }` union instead of `string | null`, and `store()` takes the acquired token as a new parameter.

**Migration:** Layered on top of the 0.198.0 signature change: check() is now check(tenantId, userId, requestId) returning { status: "cached", result } | { status: "acquired", token }; store() is now store(tenantId, userId, requestId, token). Both call sites in this repo (dispatch-batch.ts, the dispatcher test mock) are already updated; any code outside this repo calling IdempotencyGuard directly needs the same update.

**GET /files/:id now sniffs bytes and serves svg/txt/csv/json/md as application/octet-stream instead of inline (fw#2140).**

GET /files/:id served the stored mimeType as Content-Type without verifying it against the file's actual bytes — a client can declare any MIME at upload time, so an attacker could upload real HTML/SVG content and have it served back with a trusted-looking Content-Type from the app origin, enabling stored XSS. Uploads themselves are still accepted regardless of declared MIME (this is unchanged); the fix hardens serving instead. The download route now sniffs the file's magic bytes and only serves the sniffed Content-Type inline when it matches a known-safe binary signature (png/jpeg/gif/webp/pdf) AND matches the declared MIME from upload. Anything else — including a genuine mismatch, or file types with no reliable binary signature such as svg/txt/csv/json/md — is now served as application/octet-stream. This also adds X-Content-Type-Options: nosniff to GET /files/:id, which previously had none.

**Migration:** Breaking for consumers that render uploaded svg/txt/csv/json/md files inline (e.g. an <img src> pointing at GET /files/:id): those now download as application/octet-stream instead of rendering. Route such content through a purpose-built safe viewer if inline rendering is required.

## 0.198.0

### framework-core

**IdempotencyGuard.check/.store signature changed to (tenantId, userId, requestId); SqlExpression is branded (fw#2049).**

Security hardening (audit "Welle 2"): closes a request-supplied-JSON-can-forge-raw-SQL path and a cross-tenant idempotency-cache collision. `SqlExpression` is now branded — only the `sql` template tag and `sql.raw(...)` produce a value the query layer recognizes as raw SQL; an object literal built by hand (`{ kind: "sql-expr", sql: ..., params: ... }`) is no longer treated as raw SQL and gets bound as an ordinary JSON parameter instead, surfacing as a broken query rather than a silent vulnerability. `IdempotencyGuard.check`/`.store` moved from `(requestId)` to `(tenantId, userId, requestId)` so the idempotency cache can no longer be hit across tenants/users by an attacker who guesses or replays a requestId; the Redis key format changed from `${prefix}${requestId}` to `${prefix}${tenantId}:${userId}:${requestId}` with no compatibility shim.

**Migration:** Replace any hand-built SqlExpression object literal with the `sql` tag or `sql.raw(...)`. Any custom IdempotencyGuard implementation, or code calling `.check`/`.store` directly (outside the dispatcher's own runBatch, which already updated), needs the new (tenantId, userId, requestId) signature. On deploy, in-flight idempotent retries older than the request's own retry window may execute a second time — same as a first-ever request, not a correctness issue, just not a cache hit.

**event-store-executor.list() now throws 422 search_adapter_not_wired instead of returning unfiltered results (fw#2032).**

event-store-executor.list() silently dropped payload.search when no SearchAdapter was wired (neither at build time via options.searchAdapter nor at runtime via runtimeOptions.searchAdapter) — the list came back unfiltered, indistinguishable from a real search result. Now throws UnprocessableError (code: "unprocessable", details.reason: "search_adapter_not_wired", details.entity) instead.

**Migration:** Breaking for consumers whose entities are searchable but have no SearchAdapter wired: a search request that used to silently no-op now returns a 422. Wire a SearchAdapter (e.g. Meilisearch) for the entity, or stop marking the field/screen searchable.

**NavIconKey closed union replaces icon?: string on nav/config-mask definitions (fw#2055).**

NavDefinition.icon, ContentCollectionDefinition.nav.icon, ScreenNavSugar.icon and ConfigMask.icon were all icon?: string — any typo (icon: "seting") compiled fine and silently fell back to a dot in the sidebar. New NavIconKey union (@cosmicdrift/kumiko-types/nav-icon, re-exported from @cosmicdrift/kumiko-framework/{engine,ui-types}) types all four against the closed set of keys the web renderer actually registers, so an unregistered icon key is now a compile error at the r.nav()/r.screen({ nav })/config-mask call site instead of a missing icon at runtime. packages/renderer-web's NAV_ICONS map is checked against the same union via `as const satisfies Record<NavIconKey, …>`, so the type and the map can no longer drift.

**Migration:** Breaking for any app that passes an icon key outside the vocabulary in packages/types/src/nav-icon.ts — such a call site will fail to compile after this bump. Fix the typo or add the missing key to both NavIconKey and renderer-web's NAV_ICONS map in the same change.

## 0.195.0

### template-resolver

**ContentEditorProps gains a required id (fw#2001).**

TextBlockEditor's Field wrapping a registered "rich"/"plain" editor pointed its htmlFor at the fixed CONTENT_EDITOR_ELEMENT_ID, which only the never-mounted textarea fallback actually used — the label was disconnected from the real input as soon as a collection declared contentFormat: "rich" or "plain". TextBlockEditor now generates a per-instance id via useId() and passes it to both the Field and the ContentEditor, so the label stays correctly associated and two editors mounted on the same page no longer collide on a shared DOM id.

**Migration:** A custom-registered content editor component now needs to accept and use this id prop, rendering it onto its own focusable root element. Consumers that don't touch the DOM id directly are unaffected. CONTENT_EDITOR_ELEMENT_ID stays exported as a default value for callers that don't need their own generated id.

## 0.194.0

### file-derivatives

**PRESET_VARIANT_NAMES removed from public exports; publicVariantQuery accepts any name.**

The public GET /media/:fileRefId/:variant route now resolves the variant spec from the FileRef's field declaration (createImageField({ variants: {...} })) instead of a fixed spec table, so an app can declare and publicly serve its own variant names, and a field overriding a built-in preset name (thumb/card/hero/full) is served with its own spec instead of the frozen preset size. publicVariantQuery's schema now accepts any variant name (z.string().min(1).max(64)) instead of z.enum(PRESET_VARIANT_NAMES); resolution requires an exact match against the field's declared variants keys, and an unresolvable name answers 404, same as an unknown FileRef. The route's pre-DB path-param gate is now purely syntactic ([a-zA-Z0-9_-]{1,64}) instead of a name allow-list; a known-valid preset name plus a random fileRefId reached the same DB read as any other name, so the list only blocked the cheaper of two equally-costly attacks, and the actual defense is the existing per-IP rate limit and the UUID guard, both unchanged.

**Migration:** PRESET_VARIANT_NAMES only ever named the allow-list this release deletes, so there is nothing to migrate to. thumb/card/hero/full remain as ready-made specs to spread into a field's own variants.

## 0.193.0

### framework-core

**Image fields get named derived variants; ImageFieldDef/ImagesFieldDef.thumbnails removed (fw#1973).**

createImageField now accepts variants: Record<string, VariantSpec> — boot-validated named derived-image specs, served via GET /api/files/:id/variant/:name behind the same tenant + access guard as the download. A request carries only a NAME, never a spec, so no caller can drive an arbitrary render. The edit-form preview loads the first declared variant instead of the original.

**Migration:** ImageFieldDef.thumbnails / ImagesFieldDef.thumbnails are removed — the flag was never read by anything. Replace any reliance on it with a declared variants entry.

## 0.189.0

### framework-core

**createDateField now backs a real Postgres DATE column, round-trips as Temporal.PlainDate (fw#1924).**

type:"date" fields were silently aliased onto the same instant()/TIMESTAMPTZ column as type:"timestamp": reads returned a full ISO instant ("2026-03-15T00:00:00Z"), writes expected a bare "yyyy-mm-dd" string bound to a timestamptz column through the session's TimeZone — both directions were timezone-dependent for what is meant to be a pure calendar-day value. A date field now serializes as "2026-03-15" (Temporal.PlainDate's own toJSON()); a non-form client that Instant-parses a date field's JSON value now throws. Write shape is unchanged (bare "yyyy-mm-dd").

**Migration:** Managed (event-sourced projection) tables: the generator emits DROP TABLE + CREATE TABLE and replays from the event log automatically — factor in replay cost for entities with a large event history. Unmanaged (store_*, direct-write) tables: the generator emits an in-place ALTER TABLE … ALTER COLUMN … TYPE date USING (col AT TIME ZONE 'UTC')::date, anchored explicitly at UTC — do not hand-write a bare ALTER COLUMN … TYPE date without USING, which falls back to Postgres's session-TimeZone-dependent implicit cast.

## 0.177.0

### framework-core

**createMoneyField's amount now converts to/from minor-unit BIGINT storage (fw#1767).**

flattenMoney/rehydrateMoney used to pass the API amount straight into the BIGINT column without the minor-unit (cents) conversion the column's own doc comment always claimed. A decimal amount (e.g. 56799.16) crashed the insert (float into bigint); a plain integer major-unit amount (e.g. 45000 meaning €450.00) was silently stored as 45000 minor units — 100× too small on read-back.

**Migration:** amount is now always major units (ordinary decimal, e.g. 56799.16) on both write and read — DB storage stays exact-integer cents automatically, no caller change needed for that direction. If you already wrote createMoneyField data under the old (unconverted) semantics, multiply stored amounts by 100 before upgrading, or reconcile after — no known production deployment currently persists money-typed data (verified solon and phronexsis are both pre-launch before this merged).

## 0.167.1

### user

**user.locale no longer defaults to "de" (fw#1637).**

The entity-level default contradicted tenant-settings' own "en" default and silently overrode any app or tenant locale configuration for every new user. locale now stays unset until the client or a resolution chain provides one. Consumers that already fall back with `user.locale ?? "en"` are unaffected in shape but now see null instead of "de".

**Migration:** Run `kumiko-schema generate` and apply — the migration emits `ALTER TABLE read_users ALTER COLUMN locale DROP DEFAULT`. Note that DROP DEFAULT only affects future inserts: existing rows keep the "de" the old default wrote, which no user ever chose. Your app therefore splits into pre-bump users on "de" and post-bump users on null, and each group resolves to a different language. Decide deliberately: either keep the old values (and state that pre-bump users stay German), or run `UPDATE read_users SET locale = NULL WHERE locale = 'de'` once so every user follows the same chain — the latter only if no UI ever let users edit the field, otherwise it erases real choices. If your app relied on the implicit German default, set an explicit fallback instead (fw#1653).

## 0.167.0

### crypto-shredding

**Test-only reset helpers moved from /crypto to /testing (fw#1631).**

resetPiiSubjectKmsForTests and resetBlindIndexKeyForTests are no longer exported by the production barrels. The functions did not change — only the export path. Why it matters beyond tidiness: resetPiiSubjectKmsForTests clears the injected KMS, after which encryptForStorage sees no adapter and writes subject-annotated fields in plaintext, with no error and no log. Reachable from a production barrel, that is one stray import away from silent plaintext PII.

**Migration:** Change the import in your test files: `import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-framework/testing"` instead of `.../crypto`. Type-check catches every occurrence; nothing else changes. Apps mounting crypto-shredding typically hit this in every test that configures an InMemoryKmsAdapter.

### framework-core

**resetEntityFieldEncryptionCacheForTests / resetEventPiiCatalogForTests moved to /testing (fw#1631).**

Test-only reset helpers with no owning feature: resetEntityFieldEncryptionCacheForTests left the /db barrel, resetEventPiiCatalogForTests left /crypto. The functions did not move, only their export path.

**Migration:** Import both from "@cosmicdrift/kumiko-framework/testing" instead of "/db" and "/crypto". Relative deep-imports of the defining module are unaffected.

**Six identity-sensitive error classes moved from kumiko-types into kumiko-framework (fw#1616).**

VersionConflictError, IdempotentAppendConflictError and ArchivedStreamError now live in /event-store, KeyErasedError, KeyNotFoundError and KeyAlreadyExistsError in /crypto — the public paths callers already import from. With no classes left in it, kumiko-types is a plain dependency again instead of a peerDependency, which closes the changesets cycle that escalated every minor release to a major.

**Migration:** Only affects direct imports from the removed @cosmicdrift/kumiko-types/event-store-errors subpath: import from @cosmicdrift/kumiko-framework/event-store or /crypto instead. Apps importing from the framework paths need no change.

## 0.166.0

### document-ingest-foundation

**documentExtract.pages: tenantOwned instead of encrypted, and the feature now requires tenant-lifecycle**

`pages` holds the full extracted text of ingested documents (invoices, IDs, contracts) and was `encrypted: true` — app-master-key ciphertext with no erasure subject, so no Art. 17 path could ever make it unreadable. It is now `tenantOwned: true`, which binds it to the tenant subject key that tenant-destroy's eraseSubjectKeys shreds. The feature registers an EXT_TENANT_DATA destroy hook for it, and since tenant-lifecycle hosts that extension point, `document-ingest-foundation` now declares it as a hard requirement — mounting the feature without tenant-lifecycle (plus its own tenant + compliance-profiles requires) makes createRegistry throw (#1621).

**Migration:** Mount createTenantFeature(), createComplianceProfilesFeature() and createTenantLifecycleFeature() alongside documentIngestFoundationFeature. Rows written before this version carry master-key envelope ciphertext that the subject-decrypt path does not recognise — readIngestPages returns [] for them. There is no reencrypt job; if you have existing extracts you care about, decrypt and rewrite them before upgrading.

## 0.165.1

### auth-email-password

**makeAuthGate / makeSessionAuthGate take a single LoginRouteOptions object (fw#1545).**

The four positional args (LoginComponent, loginProps, MfaVerifyComponent, MfaSetupComponent) did not scale past two optional MFA params. Shipped in the stranded 2.0.0 major and carried into the 0.165.1 line.

**Migration:** Rewrite call sites as makeAuthGate({ loginScreen, loginScreenProps, mfaVerifyScreen, mfaSetupScreen }). Type-check catches every occurrence.

## 0.165.0

### config

**Reencrypt job: removed legacy-decrypt path**

The old single-key format (CONFIG_ENCRYPTION_KEY) is no longer supported. The reencrypt job now classifies rows as rotate/current/unrecognized — unreadable rows are counted as failed instead of silently attempted.

**Migration:** If any config values still exist in the old single-key format, re-encrypt them with the current envelope format before upgrading. The job will now throw an error instead of attempting migration.

### user-data-rights

**Export download: removed ?token= query param**

GET /user-export/by-token no longer accepts the token as a query parameter. Only POST body (read from URL fragment) is supported now. Old email links with ?token= in the URL will stop working.

**Migration:** Replace any existing export links that use ?token= in the URL with POST-based links. The token is now only read from the URL fragment (#token), which browsers never send to the server.
