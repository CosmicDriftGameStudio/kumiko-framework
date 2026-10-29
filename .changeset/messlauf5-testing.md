---
"@cosmicdrift/kumiko-testing": minor
---

testing: `dropTestDb` drops a test database by name.

<!-- kumiko-changes
feature: testing
type: improvement
title: dropTestDb drops a test database by name
detail: `dropTestDb(baseUrl, dbName)` from `@cosmicdrift/kumiko-testing/stack` drops a database through an admin connection, for persistent databases made with `createTestDb({ persistent: true, dbName })`; the cleanup of `createTestDb` uses it too.
-->
