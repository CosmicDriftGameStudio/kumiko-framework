# Changelog

All notable changes to Kumiko are documented here. The format loosely follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versioning will
track [Semantic Versioning](https://semver.org) once we cut a 0.1.0 tag —
until then the framework is pre-release and breaking changes land on `main`
with migration notes in the relevant commit message.

## Unreleased

### Added
- **Async event-dispatcher (AsyncDaemon pattern).** Cursor-based delivery of
  events to consumers, per-consumer checkpoints in `kumiko_event_consumers`,
  halt-on-poison with dead-letter after configurable retries. Replaces the
  transactional outbox for post-commit side-effects.
- **`r.postEvent(name, handler)` registrar.** Features can subscribe to the
  full event stream; each subscriber gets its own cursor and runs
  independently.
- **`r.projection()` with custom read-models.** Inline projections fed from
  aggregate events inside the write TX. Includes `rebuildProjection()` for
  full replays and a CLI (`yarn kumiko project list|status|rebuild`).
- **Event-sourced CRUD executor.** `r.crud()` now appends events to the
  events table in the same TX as the entity write; full event log with
  tenant isolation, unique `(aggregate_id, version)` constraint, request-id
  idempotency.
- **Sensitive field flag** (`sensitive: true`). Fields marked as such are
  stripped from every event payload (create/update/delete/restore) while
  the entity table keeps them — GDPR right-to-be-forgotten by default.
- **Observability for projections.** `kumiko_projection_rebuild_duration_seconds`
  histogram + `kumiko_projection_rebuild_events_total` counter, success and
  failure labels.

### Changed
- **SSE broadcast via event-dispatcher.** Payload shape is now the stored
  event (`{ type: "user.created", data: { id, aggregateType, version,
  payload, createdAt } }`) instead of the old `system:event:<entity>:<verb>`
  wrapper. Delivery is eventually consistent (~pollIntervalMs after commit).
  Pub/sub events (aggregateType="pubsub") are filtered out by the default
  SSE consumer — features that want them broadcast register their own
  consumer.
- **Search indexing via event-dispatcher.** State reconstructed from the
  event payload (create → full state, update → `{...previous, ...changes}`,
  restored → `previous`). Delete → `remove(tenantId, type, id)`. Single
  call per event for now; batch-variant removed (can return if perf
  measurement justifies it).
- **`ctx.emit` persists into the events table.** Pub/sub events become
  synthetic single-event streams (`aggregateType: "pubsub"`, fresh UUID,
  version 1). One ordered log for all async delivery — aggregate events
  and pub/sub events share the same dispatcher infrastructure.

### Removed
- **Transactional outbox.** `event_outbox` table, poller, broker, and
  retention cleanup are gone. Replaced by the event-dispatcher + events
  table. The old delivery semantics (at-least-once, request-id-keyed) are
  preserved; the mechanism is simpler.
- **Audit-trail system hook.** Events are audit — `createdBy`, `createdAt`,
  `payload.previous`, `payload.changes` cover the same ground without a
  parallel table. `createAuditTrailHook`, `AuditTrailStorage`,
  `samples/audit-trail` are all removed.
- **Legacy post-save/post-delete SSE + search hooks.** Replaced by the
  async event-consumers above.

### Migration notes
- `r.defineEvent` + `ctx.emit` is still the way features emit cross-feature
  events; the underlying storage moved from `event_outbox` to `events`. No
  API change for feature authors.
- Consumer registration moved from `eventBroker.subscribe(type, handler)`
  to `r.postEvent(name, handler)`. The handler sees the full event stream
  and filters on `event.type` itself.
- Tests that assert on side-effects must drain the dispatcher with
  `await stack.eventDispatcher?.runOnce()` before asserting on SSE,
  search, or pub/sub observers. `setupTestStack`'s `beforeEach` pattern
  (drain-then-reset) isolates test perimeters.
