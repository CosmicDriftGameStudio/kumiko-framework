---
"@cosmicdrift/kumiko-dev-server": patch
---

Dockerfile.template setzt `YARN_ENABLE_SCRIPTS=false` im Build-Stage. Fixt msgpackr-extract native-build-Failures (ARM, CI) und generell jeden transitiven Native-Dep — der Build-Stage bundlet nur JS via `bun build`, Runtime-Native-Deps werden separat im Runtime-Stage via `bun install --production` installiert. Apps die bisher per-package-Workarounds via `dependenciesMeta.<pkg>.built=false` in der App-package.json brauchten (studio, enterprise) können diese Entries nach Upgrade auf diese dev-server-Version entfernen.
