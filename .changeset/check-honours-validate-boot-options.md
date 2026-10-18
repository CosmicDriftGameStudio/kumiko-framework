---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-dev-server": minor
---

`kumiko check` honours the boot-validator options declared in kumiko.config.ts

The boot step of `kumiko check` ran `validateBoot` without the options the app passes to `runProdApp`, so allowlisted or exempted navs still warned there. `defineAppConfig` now takes an optional `validateBootOptions` (`navAllowlist`, `navAllowlistExempt`, `warnOnUniqueAccessRoles`; `env` and the cipher stay runner-owned). The managed `kumiko/schema.ts` exports it as `VALIDATE_BOOT_OPTIONS`, `kumiko check` and `kumiko-schema validate` hand it to `validateBoot`, and a wrong shape fails the boot step with a clear message. New apps pass the same options from their `bin/main.ts` and `bin/server.ts` to `runProdApp` and `runDevApp`.

<!-- kumiko-changes
feature: framework
type: improvement
title: kumiko check validates the boot configuration with the validateBootOptions from kumiko.config.ts
detail: Set validateBootOptions in defineAppConfig (navAllowlist, navAllowlistExempt, warnOnUniqueAccessRoles); the managed kumiko/schema.ts exports it as VALIDATE_BOOT_OPTIONS and kumiko check validates with it. Apps with a hand-written kumiko/schema.ts can export VALIDATE_BOOT_OPTIONS themselves.
migration: Existing apps get the new line in kumiko/schema.ts through `kumiko-upgrade --apply` (managed file). The bin files belong to the app: pass `...(appConfig.validateBootOptions && { validateBootOptions: appConfig.validateBootOptions })` to runProdApp in bin/main.ts and to runDevApp in bin/server.ts (import appConfig from "../kumiko.config") so runtime and kumiko check agree.
-->
