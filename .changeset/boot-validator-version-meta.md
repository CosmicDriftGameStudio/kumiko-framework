---
"@cosmicdrift/kumiko-framework": patch
---

Boot-Validator: `version` als pick/map-Quelle in Action-Extractoren erlauben — Row-Meta (id, version) ist auf jeder Entity-Row vorhanden ohne Entity-Field zu sein; `pick: ["id", "version"]` ist das Standard-Payload für optimistic-lock-Lifecycle-Writes. Der 0.40.0-Validator lehnte solche rowActions beim Boot ab (Prod-CrashLoop publicstatus).
