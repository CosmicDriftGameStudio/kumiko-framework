---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-types": patch
"@cosmicdrift/kumiko-server-runtime": patch
"@cosmicdrift/kumiko-dev-server": patch
"@cosmicdrift/kumiko-cli": patch
"@cosmicdrift/kumiko-guards": patch
---

Settle and consume racing on a swept cap reservation book their units again, schema status and baseline use one connection, package lookups no longer auto-install from the registry, and fresh scaffolds build with `bun run build`.

<!-- kumiko-changes
feature: cap-counter
type: fix
title: Settle and consume racing on a swept reservation book their units
detail: After the sweep deleted a reservation's row, a consume could commit its released tombstone between the two reads of a parallel settle or consume. That call took the released tombstone for a settled one, so settle reported success without booking its amount and a second consume was rejected with cap_reservation_settled. Only a settled tombstone counts as settled now; a released one runs into the insert conflict and the retry books against it.
-->

<!-- kumiko-changes
feature: framework
type: improvement
title: schema status and baseline use one connection, bun-types is a peer dependency
detail: kumiko schema status and baseline open a pool of one connection instead of the default size, because Bun.SQL dials every pool connection on the first query. bun-types is now a peer dependency (^1.4.4) of framework, types, server-runtime and dev-server instead of a regular dependency, so install it next to the framework.
-->

<!-- kumiko-changes
feature: server-runtime
type: improvement
title: Package lookups no longer auto-install from the registry
detail: The new @cosmicdrift/kumiko-server-runtime/resolve-installed-package export looks up node_modules before asking Bun.resolveSync, which installs missing packages from the registry since Bun 1.4.4. The prod build, the dev-server stylesheet lookup and the handbuch commands use it.
-->

<!-- kumiko-changes
feature: dev-server
type: improvement
title: Scaffolded docker-compose raises Postgres max_connections to 300
detail: Bun.SQL dials its whole pool eagerly, so the default limit of 100 is too tight for an app plus its tests. Existing apps can add command postgres -c max_connections=300 to the postgres service.
-->

<!-- kumiko-changes
feature: dev-server
type: fix
title: Fresh scaffolds build with bun run build
detail: create-kumiko-app now writes public/index.html with the /styles.css and /client.js placeholders. Without it kumiko-build stopped with a missing-template error, so the scaffolded Dockerfile could not build either.
-->
