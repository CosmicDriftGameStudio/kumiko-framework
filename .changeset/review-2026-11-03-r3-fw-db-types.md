---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-server-runtime": patch
"@cosmicdrift/kumiko-types": patch
---

Review round 3 for db and types: reference eagerload reads restricted targets in one query, the rebuild guard compares the tenant isolation policy expression, scoped transaction statements send the scope and the statement together, the search reindex fingerprint follows payload extension code, physicalColumnName takes a SchemaTable again, the unused header and query redaction lists are removed, and a leftover lastDate placeholder in group headers no longer shows up literally.

<!-- kumiko-changes
feature: framework
type: breaking
title: Db and types review fixes
detail: Eagerload of a reference to an entity with row-level read rules runs one SELECT with the access clause instead of a probe query followed by a lookup, so unreadable rows are never loaded. The rebuild guard now also compares the USING and WITH CHECK expressions of kumiko_tenant_isolation with the framework policy (deparsed the same way on a throwaway table) and refuses the rebuild when they differ. Statements on an enforced transaction handle send set_config and the statement back to back instead of waiting for the scope first. The search reindex fingerprint hashes the source of each search payload extension instead of only counting them, so changed extension code reindexes. physicalColumnName takes a SchemaTable (new guard isSchemaTable exported from the db barrel); the inbound-mail ownership rule narrows its context table with it. SensitiveFilterConfig loses redactedHeaders and redactedQueryParams, which nothing read. A group header text that still contains the removed {lastDate} placeholder renders without it and warns once per key. Eagerload of a reference to an entity with row-level read rules now runs the rows through the normal row coercion (camelCase keys, no blind-index columns) before decrypting. A plain statement issued inside a running unit queues behind sibling units pending in that unit's chain instead of landing in the open savepoint. The PII backfill treats a newer event that sets a field to null as a newer value, so the older owner's ciphertext is no longer re-keyed onto the new owner. `reindexEntity` takes `onlyEntityId` to reindex a single row. `isUnchangedValue` (key-order-stable comparison) is exported from the engine barrel. `seedRow` and `seedRows` now also refuse an event-sourced entity when handed its table meta instead of the table. POST /files answers an anonymous caller with 401, not 413, when no field allows anonymous upload.
migration: Remove redactedHeaders and redactedQueryParams from any sensitiveFilter option and from DEFAULT_SENSITIVE_CONFIG overrides. Pass a SchemaTable (or narrow with isSchemaTable) to physicalColumnName instead of an unknown value. Replace {lastDate} in table.grouping label texts with a max measure in table.totals.
-->
