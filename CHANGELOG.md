# Changelog

Kumiko is released with [Changesets](https://github.com/changesets/changesets).
All published packages share one version (a `fixed` group), so a release bumps
every package together. Kumiko is pre-1.0: a minor bump can contain breaking
changes. See the [stability policy](docs/reference/stability-policy.md).

## Where the release notes live

Each package keeps its own changelog, generated on every release:

| Package | Changelog |
|---------|-----------|
| `@cosmicdrift/kumiko-framework` | [packages/framework/CHANGELOG.md](packages/framework/CHANGELOG.md) |
| `@cosmicdrift/kumiko-types` | [packages/types/CHANGELOG.md](packages/types/CHANGELOG.md) |
| `@cosmicdrift/kumiko-bundled-features` | [packages/bundled-features/CHANGELOG.md](packages/bundled-features/CHANGELOG.md) |
| `@cosmicdrift/kumiko-server-runtime` | [packages/server-runtime/CHANGELOG.md](packages/server-runtime/CHANGELOG.md) |
| `@cosmicdrift/kumiko-dev-server` | [packages/dev-server/CHANGELOG.md](packages/dev-server/CHANGELOG.md) |
| `@cosmicdrift/kumiko-http` | [packages/http/CHANGELOG.md](packages/http/CHANGELOG.md) |
| `@cosmicdrift/kumiko-dispatcher-live` | [packages/dispatcher-live/CHANGELOG.md](packages/dispatcher-live/CHANGELOG.md) |
| `@cosmicdrift/kumiko-headless` | [packages/headless/CHANGELOG.md](packages/headless/CHANGELOG.md) |
| `@cosmicdrift/kumiko-renderer` | [packages/renderer/CHANGELOG.md](packages/renderer/CHANGELOG.md) |
| `@cosmicdrift/kumiko-renderer-web` | [packages/renderer-web/CHANGELOG.md](packages/renderer-web/CHANGELOG.md) |
| `@cosmicdrift/kumiko-locale-de` | [packages/locale-de/CHANGELOG.md](packages/locale-de/CHANGELOG.md) |
| `@cosmicdrift/kumiko-locale-es` | [packages/locale-es/CHANGELOG.md](packages/locale-es/CHANGELOG.md) |
| `@cosmicdrift/kumiko-cli` | [packages/cli/CHANGELOG.md](packages/cli/CHANGELOG.md) |
| `@cosmicdrift/kumiko-testing` | [packages/testing/CHANGELOG.md](packages/testing/CHANGELOG.md) |
| `@cosmicdrift/kumiko-guards` | [packages/guards/CHANGELOG.md](packages/guards/CHANGELOG.md) |
| `@cosmicdrift/kumiko-repo-manifest` | [packages/repo-manifest/CHANGELOG.md](packages/repo-manifest/CHANGELOG.md) |
| `create-kumiko-app` | [packages/create-kumiko-app/CHANGELOG.md](packages/create-kumiko-app/CHANGELOG.md) |

Most API changes land in `kumiko-framework`, `kumiko-types` and
`kumiko-bundled-features`; start there.

Breaking changes carry a migration note in the changelog entry. The same notes
are collected in each package's `changes.json`, which the upgrade tool reads.

## Upgrading an app

```bash
bunx kumiko-upgrade                  # what changed since your installed version
bunx kumiko-upgrade --from 0.300.0   # ... since a specific version
bunx kumiko-upgrade --apply          # run the codemods of pending breaking changes
```

Pin exact versions and read every entry between your current and target
version, not only the latest one.

## History before Changesets

Notes from before per-package changelogs existed (pre-0.1, May 2026).

### Added
- **Async event-dispatcher (AsyncDaemon pattern).** Cursor-based delivery of
  events to consumers, per-consumer checkpoints in `kumiko_event_consumers`,
  halt-on-poison with dead-letter after configurable retries. Replaces the
  transactional outbox for post-commit side-effects.
- **`r.multiStreamProjection({ name, apply, table? })` registrar (Sprint E
  gold standard).** Features register async consumers that react to events
  from any aggregate stream. Each consumer gets its own cursor, a persistent
  projection table (or pure side-effect mode when `table` is omitted), and
  runs independently. Replaces the Sprint-D-era `r.postEvent(name, handler)`
  registrar, which was removed in Sprint E.2.
- **`r.projection()` with custom read-models.** Inline projections fed from
  aggregate events inside the write TX. Includes `rebuildProjection()` for
  full replays and a CLI (`bun kumiko project list|status|rebuild`).
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
  to `r.multiStreamProjection({ name, apply })`. The apply map is keyed by
  event type; the framework routes each stored event to the matching handler.
- Tests that assert on side-effects must drain the dispatcher with
  `await stack.eventDispatcher?.runOnce()` before asserting on SSE,
  search, or pub/sub observers. `setupTestStack`'s `beforeEach` pattern
  (drain-then-reset) isolates test perimeters.
