---
"@cosmicdrift/kumiko-framework": minor
---

Settings-Hub: derive one screen per scope-level a masked config key spans

The self-populating Settings-Hub (`buildConfigFeatureSchema`) now follows the
config cascade `env → system → tenant → user` when deriving screens. Previously
a masked key produced exactly one `configEdit` screen at its declared home
scope; now it produces a screen at **every** scope from `system` down to its
home, so a single declaration drives the whole per-role settings UI.

Per-level access:

- **Home scope** keeps the key's full `access.write` set (unchanged).
- **A broader scope** (e.g. a tenant-home key at the system level) is offered
  only when the key's write-set names an _elevated_ role for that level —
  `SystemAdmin` at system, `TenantAdmin`/`Admin` at tenant — and the generated
  screen is gated to exactly that intersection.

Effect: a tenant-home key such as SMTP whose write-set is the `admin` preset
(`∋ SystemAdmin`) now yields a **SystemAdmin-only Plattform screen** (set the
platform-wide default) **plus** the existing tenant screen (the per-tenant
override) — the "sysadmin sets the default, tenant admin overrides" cascade is
now buildable purely by declaring `mask`, with no hand-written `r.screen`/`r.nav`.
A key whose write-set names no elevated role gets no broader screen (the
write-set is the opt-in).

Hardening: a masked key whose effective write-set at a scope is only the
internal machine actor (`access.system` = `["system"]`) no longer surfaces in
the human hub at all (build-time exclusion). Such a field could otherwise render
on a screen made visible by co-grouped human keys yet reject the viewer's write.

No app changes are required to adopt; apps that only declared `mask` on
tenant-home keys with the default `admin` write-set will gain the new
SystemAdmin platform-default screens automatically.
