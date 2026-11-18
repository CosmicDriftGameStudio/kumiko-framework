---
"@cosmicdrift/kumiko-guards": patch
---

The runtime-isolation check in `kumiko-guards checks` now fails browser code that imports a server entry point of a Kumiko package, such as `@cosmicdrift/kumiko-framework/engine` instead of `/ui-types`.

<!-- kumiko-changes
feature: guards
type: improvement
title: Runtime-isolation check catches server entries in the browser bundle
detail: An app file reachable from a client entry that value-imported `@cosmicdrift/kumiko-framework/engine` (or `/db`, `/event-store` and other server entries of an installed Kumiko package) used to pass the guard, because imports into `node_modules` were never judged; pino then landed in the client bundle and the app did not start in the browser. The check now judges such imports by the package's own markers: `kumiko.runtime`, the guard's path rules applied to the file's source path (`repository.directory`, published `dist/` mapped back to `src/`), and the `exports` whose target classifies as client. The finding names the file, the import chain from the client entry and the client-safe entry that exports the imported names (for example `import handlerTranslationKeys from "@cosmicdrift/kumiko-framework/ui-types"`), or lists the package's client-safe entries when none does. Type-only imports do not count. These findings cannot be frozen in `.kumiko-runtime-isolation-baseline.json`. `@cosmicdrift/kumiko-framework/auth` (the `ROLES` constants) now counts as client-safe. If the check turns red, import from the named entry or move the import into server-only code.
-->
