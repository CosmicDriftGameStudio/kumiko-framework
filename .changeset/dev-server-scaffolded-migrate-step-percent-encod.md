---
"@cosmicdrift/kumiko-dev-server": patch
---

Scaffolded migrate step percent-encodes DB_PASSWORD

dev-server: the scaffolded `deploy/migrate-step.sh` percent-encodes `DB_PASSWORD` in `DATABASE_URL`, so passwords with `@`, `:`, `/`, `#`, `%` or non-ASCII characters no longer break the URL. Re-run `kumiko init-deploy` to pick it up; apps with a hand-written `urlencode` should take the new version, which also encodes bytes >= 0x80 correctly.

<!-- kumiko-changes
feature: dev-server
type: fix
title: Scaffolded migrate step percent-encodes DB_PASSWORD
-->
