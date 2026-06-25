---
"@cosmicdrift/kumiko-bundled-features": minor
---

feat(user-data-rights): zero-callback GDPR emails via mail-foundation (C6)

`user-data-rights` now ships default `send*Email` implementations + email
templates for the four GDPR notifications (export-ready, export-failed,
deletion-requested, deletion-executed). Mount `mail-foundation` + any
`mail-transport-*` (e.g. `mail-transport-smtp`) and the feature sends these
mails itself — no app callback code. An app that passes its own `send*Email`
opt keeps full control (the default only fills the gap). The default mails
render in the recipient's own `user.locale` (de/en); `mailDefaults`
(`{ locale, appName }`) brands them and supplies the locale fallback for
unknown/unsupported values. Export-ready additionally needs
`appExportDownloadUrl` (a one-shot operator warning fires if a transport is
mounted but the URL is unset).

The four `send*Email` callback args gain a `userLocale` field (additive — apps
with their own callbacks may ignore it).

The job-lane crons (export/forget) reach the per-tenant transport through a new
`makeTenantMailTransportResolver`, mirroring the file-provider resolver: the
cron ctx carries `configResolver` (the per-request `ConfigAccessor` exists only
in the HTTP dispatcher), so the resolver builds a per-tenant accessor from it.
The deletion-requested mail runs in the request lane and uses the request ctx
directly. The anonymous-flow verification mail stays app-wired by design — a
synchronous default would reintroduce an account-enumeration timing oracle.

**Plugin-author-facing change:** `MailTransportPlugin.build(ctx, tenantId)` and
`createTransportForTenant(ctx, tenantId)` now take a narrow `MailTransportContext`
(`{ config?, registry?, secrets?, _userId? }`) instead of the full
`HandlerContext`, mirroring file-foundation's `FileProviderContext`. The full
`HandlerContext` from the request lane is still assignable, so request-path
callers are unaffected; custom `mail-transport-*` plugins that annotated
`build(ctx: HandlerContext)` should switch to `MailTransportContext`. This also
fixes a latent worker-lane crash: the previous `HandlerContext` typing invited a
synthetic-ctx cast that would have read request-only fields absent in the cron
lane.
