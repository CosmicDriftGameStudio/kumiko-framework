---
"@cosmicdrift/kumiko-bundled-features": minor
---

`createFeatureTogglesFeature({ getRuntime })` — `getRuntime` ist jetzt
optional. Smoke-Apps (`KUMIKO_DRY_RUN_ENV=boot`) wirken die feature
ohne runtime-stub-cast aus; production-Apps + Tests müssen den accessor
weiter setzen.

Internal: set-handler + toggle-cache-sync MSP fail jetzt lazy mit
einer aktionsfähigen message, falls jemand `getRuntime` weglässt aber
trotzdem dispatchet. Vorher mussten App-Authors `null as unknown as
GlobalFeatureToggleRuntime`-doublecasts schreiben — Coding-standards
verbieten das.
