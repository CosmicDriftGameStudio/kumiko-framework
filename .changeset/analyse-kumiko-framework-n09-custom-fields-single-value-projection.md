---
"@cosmicdrift/kumiko-bundled-features": minor
---

Custom-field values of every wired host entity are now written by one projection owned by the custom-fields feature.

<!-- kumiko-changes
feature: custom-fields
type: breaking
title: One custom-fields value projection for all wired host entities
detail: `wireCustomFieldsFor` no longer registers a multi-stream projection `<feature>:projection:custom-fields-<entity>-projection` per host entity. The custom-fields feature registers one projection, `custom-fields:projection:host-values`, that finds the host table through the registry, so each value event runs through one consumer instead of one per wired host. The signature of `wireCustomFieldsFor` is unchanged. The new consumer starts at the beginning of the event log and replays the value events once; the replay is idempotent. A `custom-field-set` event without a value is now skipped without a console warning.
migration: After the deploy, disable each stale consumer `<feature>:projection:custom-fields-<entity>-projection` with the jobs feature's `consumer-disable` write handler. Its cursor no longer advances, so `pruneEvents` would otherwise fail with `ConsumerLagError`.
affects: wireCustomFieldsFor, custom-fields
-->
