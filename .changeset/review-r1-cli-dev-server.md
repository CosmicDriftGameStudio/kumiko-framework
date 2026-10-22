---
"@cosmicdrift/kumiko-cli": patch
"@cosmicdrift/kumiko-dev-server": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

CLI and dev-server hardening: managed/scripts checks warn before adoption, sync-managed resolves the repo root, resources are released on boot failure, late-bound revokers unbind safely, server lockfile is verified.

<!-- kumiko-changes
feature: cli
type: fix
title: check, sync-managed and backfill-pii handle failure and subdirectories correctly
detail: kumiko check only warns about unresolvable managed files or package.json scripts until kumiko.config.ts calls defineAppConfig. sync-managed resolves the repo root like check instead of using cwd. ops backfill-pii closes the KMS wiring when registry creation fails. The agent command reuses allAppFeatures from the framework config.
-->

<!-- kumiko-changes
feature: dev-server
type: fix
title: runDevApp releases the KMS on any boot failure; server lockfile is verified
detail: runDevApp closes the KMS wiring when a boot gate throws before the server is created. Stopping one app no longer replaces the session, MFA and PAT revokers a newer app bound on the same feature instances: the bind functions of sessions, auth-mfa and personal-access-tokens return an unbind that only clears its own binding. writeServerLockfile replays the frozen install the runtime image runs, so a lock that did not re-resolve fails in kumiko-build.
-->
