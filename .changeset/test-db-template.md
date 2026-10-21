---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-testing": patch
"@cosmicdrift/kumiko-dev-server": patch
---

Integration runs build each distinct test schema once as a template database and clone it per test stack with `CREATE DATABASE ... TEMPLATE`, instead of running the DDL for every stack.

<!-- kumiko-changes
feature: testing
type: fix
title: Integration test stacks clone a migrated template database
detail: kumiko-testing integration and the framework integration runner set a run id; setupTestStack then builds one template per schema fingerprint under an advisory lock and clones it, and the runner drops the templates at the end. Plain bun test runs keep the in-place DDL path. setupAppTestStack skips pushEntityProjectionTables on fresh databases.
-->
