---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-headless": minor
"@cosmicdrift/kumiko-renderer": minor
---

Select fields can load their options from a query

A `select` config key and a `select` field on configEdit and actionForm screens accept `optionsQuery` (a query QN returning `{ rows: { value, label }[] }`) plus an optional static `optionsQueryPayload`. The Settings-Hub derives the field from the config key, the renderer mounts the query and shows the returned labels as they are. The boot validator rejects dead QNs, static `options` together with `optionsQuery`, `allowPerRequest` keys, and `optionsQuery` on entity fields. The write side does not check the value against the query result.

<!-- kumiko-changes
feature: framework
type: improvement
title: Select fields in configEdit and actionForm screens and select config keys can load their options from a query (optionsQuery)
migration: No code change needed. Existing select fields and config keys keep their static options.
-->
