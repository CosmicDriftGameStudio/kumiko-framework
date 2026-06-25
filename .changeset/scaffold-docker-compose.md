---
"@cosmicdrift/kumiko-dev-server": patch
---

scaffold: ship a `docker-compose.yml` (Postgres 17 + Redis 7) with `kumiko new app`. The generated README already told users to run `docker compose up -d`, but no compose file was emitted — so the documented first-run path dead-ended. Ports and credentials match the `.env.example` `*_URL` defaults.
