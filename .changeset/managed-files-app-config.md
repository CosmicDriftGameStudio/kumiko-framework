---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-dev-server": minor
"@cosmicdrift/kumiko-cli": minor
"@cosmicdrift/kumiko-testing": minor
---

Managed files, kumiko.config.ts with defineAppConfig, script standard and port registry

<!-- kumiko-changes
feature: framework
type: improvement
title: defineAppConfig in @cosmicdrift/kumiko-framework/config, plus biome and tsconfig presets for apps
detail: kumiko.config.ts default-exports defineAppConfig({ features, prodFeatures?, client: { entries }, ports: { dev, e2e, infra? } }). defineAppConfig throws on ports outside 1..65535, a port claimed twice within the app, an empty client.entries list and entries that leave the app. allAppFeatures(config) returns features plus prodFeatures. New exports @cosmicdrift/kumiko-framework/biome (Biome 2.5.7 preset with vcs.useIgnoreFile false) and @cosmicdrift/kumiko-framework/tsconfig.app.json; an app's biome.json and tsconfig.json extend them and keep their own overrides next to extends.
-->

<!-- kumiko-changes
feature: dev-server
type: improvement
title: Managed files: one template source for the scaffold, kumiko check managed and kumiko sync-managed
detail: deploy/Dockerfile, deploy/Dockerfile.dockerignore, deploy/migrate-step.sh, .husky/pre-push, .github/workflows/{ci,release,cache-cleanup}.yml, the bunfigs and kumiko/schema.ts carry a kumiko-managed marker on line 1 (line 2 after a shebang or # syntax= line). kumiko new app writes them, plus kumiko.config.ts, bin/server.ts (was bin/dev.ts), bin/env-schema.ts, e2e/_helpers and src/__tests__/_setup.ts; bunfig.ci.toml is gone. kumiko/schema.ts is generated from kumiko.config.ts. kumiko-init-deploy prints a deprecation notice and goes away in the next release. Release targets come from package.json#kumiko.deploy.namespace and .deployment (default: the app name).
migration: Existing apps: add kumiko.config.ts with defineAppConfig, then run kumiko sync-managed (dry run), kumiko sync-managed --write --adopt for files that are identical or should follow the template, and mark deliberate deviations with "# kumiko-managed: local <reason>" on line 2. Until kumiko.config.ts calls defineAppConfig, kumiko check only warns about drift and missing scripts.
-->

<!-- kumiko-changes
feature: cli
type: improvement
title: kumiko check gains the managed and scripts steps; new kumiko sync-managed and kumiko ports
detail: kumiko check managed compares framework-owned files with the installed templates and prints a diff; files with a local marker are skipped and listed. kumiko check scripts requires dev, build, start, typecheck, lint, check, test, test:unit, test:integration, test:integration:ci, test:dom (with uiRoots), test:real, e2e, e2e:real, screenshots and prepare, and lists extras. Both steps fail only once the app calls defineAppConfig. kumiko check accepts step ids as positional filters (kumiko check managed scripts). kumiko sync-managed [--write] [--adopt] writes the templates; it never overwrites a file without marker unless --adopt is passed, never touches local files and refuses symlinked paths. kumiko ports [workspace-root] lists the ports of every app below the root and exits 1 on a collision. kumiko agent lint also checks prodFeatures.
-->

<!-- kumiko-changes
feature: testing
type: improvement
title: renderTestSetup writes the standard test scripts, bunfig.dom.toml and the helper homes
detail: The scaffolded test setup now adds test:unit, test:integration:ci, test:dom and screenshots, writes bunfig.dom.toml (with @happy-dom/global-registrator as devDependency), e2e/_helpers/index.ts and src/__tests__/_setup.ts.
-->
