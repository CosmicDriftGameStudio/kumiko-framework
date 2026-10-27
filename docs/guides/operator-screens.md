---
status: reference
verified: 2026-10-27
evidence: "packages/bundled-features/src/jobs, packages/bundled-features/src/audit, packages/bundled-features/src/user-data-rights, packages/bundled-features/src/admin-shell; samples/apps/use-all-bundled/e2e/screenshots.spec.ts; samples/apps/use-all-bundled/src/app/seed.ts"
---

# Operator screens

Several bundled features ship screens for the people who run an installation: job runs, event consumers, the audit log, GDPR exports and the workspace overviews. The feature reference pages show one preview per feature; this page shows the screens behind them. The images come from the `use-all-bundled` sample, whose seed leaves one consumer stopped by an error and one paused so the screens have something to show.

## Overview pages

`admin-shell` gives each workspace a landing page. The platform overview (SystemAdmin) shows tenants, active users, failed jobs and deliveries across the installation; the tenant overview shows the same for one tenant, plus its quotas and the changes per day from the audit log.

![Tenant overview: active members, failed jobs and deliveries, deliveries by channel, a quota table with usage bars and changes per day](/screenshots/features/tenant-overview/en/default-light/desktop.png)

## Job runs

`jobs` lists every run on the platform workspace under **Jobs**. **Run a job** starts a job by name with an optional JSON payload. A click on a run opens its status, timings, error and log lines:

![Job run detail for sessions:job:cleanup: completed, run ID, start and finish time, duration 4 ms and one log line](/screenshots/features/job-run-detail/en/default-light/desktop.png)

## Event consumers

Projections and other event consumers read events after they are stored. **Event consumers** on the platform workspace lists each consumer with its status, how many events it is behind, the attempts and the last error, so a stuck one stands out:

![Event consumers list: invoice-totals stopped by error 24 events behind after 5 attempts, overdue-reminders paused, the rest up to date](/screenshots/features/event-consumers/en/default-light/desktop.png)

The detail page shows the full error. **Restart** retries the failing event; the menu next to it skips that one event or pauses the consumer:

![Event consumer detail for invoice-totals with the last error and the open menu offering Skip event and Pause](/screenshots/features/event-consumer-detail-menu/en/default-light/desktop.png)

Restart and Skip event show up only while the consumer is stopped by an error, and Skip event asks for confirmation: the skipped event is never applied by this consumer, so fix the cause and restart when you can. A paused consumer offers the action to resume it instead. The same operations exist on the command line as `kumiko consumer`.

## Audit log

`audit` reads the event store as an audit log in the tenant workspace. Each row opens the event with its actor, time, stored payload and metadata:

![Audit event detail: Template created, actor Admin, aggregate ID, event payload and metadata as JSON](/screenshots/features/audit-log-detail/en/default-light/desktop.png)

## GDPR exports

`user-data-rights` gives users a privacy center to request their data. SystemAdmins see every export request with its status, request time and expiry under **GDPR exports**:

![GDPR exports list with one pending request](/screenshots/features/export-job-list/en/default-light/desktop.png)
