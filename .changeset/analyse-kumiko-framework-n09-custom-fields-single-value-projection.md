---
"@cosmicdrift/kumiko-bundled-features": minor
---

Custom-field values of every wired host entity are now written by one projection owned by the custom-fields feature.

<!-- kumiko-changes
feature: custom-fields
type: breaking
title: One custom-fields value projection for all wired host entities
detail: `wireCustomFieldsFor` no longer registers a multi-stream projection `<feature>:projection:custom-fields-<entity>-projection` per host entity. The custom-fields feature registers one projection, `custom-fields:projection:host-values`, that finds the host table through the registry, so each value event runs through one consumer instead of one per wired host. The signature of `wireCustomFieldsFor` is unchanged. The new consumer starts at the beginning of the event log and replays the value events once; the replay is idempotent. A `custom-field-set` event without a value is now skipped without a console warning.
migration: Nothing to do by hand. The rows of the old consumers `<feature>:projection:custom-fields-<entity>-projection` stay in `kumiko_event_consumers` with a cursor that no longer advances. The bundled retention jobs (data-retention, delivery attempt log, audit escape-hatch) skip consumers the registry no longer declares once their row has not moved for seven days and log their names, so retention resumes at the latest a week after the deploy. An app that calls `pruneEvents` itself passes `registry` to get the same behaviour. Disabling the rows with `consumer-disable` is no longer needed and does no harm where it was already done.
affects: wireCustomFieldsFor, custom-fields
-->
