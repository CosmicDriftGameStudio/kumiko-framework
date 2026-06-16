---
"@cosmicdrift/kumiko-bundled-features": patch
---

config: let a human operator write a `privileged` key (fixes Settings-Hub save)

`checkWriteAccess` treated any config key whose write-set contained
`SYSTEM_ROLE` as machine-only and rejected every human with
`config.errors.systemOnly` — even when the write-set also named a human
role. So a key declared `access.privileged` (`["system", "SystemAdmin"]`,
e.g. Stripe `billing-live`) could not be saved from the derived
Settings-Hub screen by a SystemAdmin, although `build-config-feature-schema`
deliberately surfaces it to one. Saving the whole system-scope screen failed.

The check now grants access directly when the user's roles match the
write-set (machine actor for `SYSTEM_ROLE`, operator for `SystemAdmin`), and
only returns `systemOnly` for a key whose *sole* writer is `SYSTEM_ROLE`
(the `access.system` preset). A non-SystemAdmin human is still denied
(generic `access_denied`, not `systemOnly`).

Also ships default German/English translations for the `config.errors.*`
keys (`systemOnly`, `invalidScope`, `unknownKey`) via `configClient()`, so
config write errors render as text instead of a raw i18n key.

The derived configEdit screen no longer renders a source badge next to each
field label — that duplicated the source shown by the cascade disclosure
below the input (one "Fehlt"/"System" badge per field instead of two).
