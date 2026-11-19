---
"@cosmicdrift/kumiko-testing": patch
---

The test stack aligns the kumiko_app role once per process instead of once per test database.

<!-- kumiko-changes
feature: testing
type: improvement
title: Application role is aligned once per process
detail: createTestDb and the template build ran ALTER ROLE on kumiko_app for every test database. Parallel workers raced on it ("tuple concurrently updated") and every lost race wrote the statement to the Postgres server log. The role is now created or realigned once per process and database server.
-->
