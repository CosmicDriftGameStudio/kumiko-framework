# Embedded fields and lists

Keep owned, fixed-shape data with its parent entity instead of giving every
nested value its own aggregate. This recipe covers both a single embedded
object and an embedded list rendered by a declarative `entityEdit` screen.

## What it shows

- **Embedded objects** — `address` and optional `billingAddress` are validated
  sub-schemas stored in the contact row.
- **Embedded lists** — invoice `lines` repeat a fixed row shape without their
  own identity or event stream.
- **Structured cells** — a line uses a reference, select, number, and money
  cell, with `amount` derived from `quantity × unitPrice` and a totals row.
- **Server-authoritative derived cells** — the write schema recomputes
  `derived` values before validation, so a client cannot supply a stale amount.
- **Declarative editing** — the `invoice-edit` screen uses the framework's
  embedded-list field; no custom screen component is required.

## When to reach for it

Use an embedded field or list when the nested data is created, changed, and
deleted with its parent. Promote a row to its own entity when it needs an
independent status, history, or handler.

## Source

The feature entry point is `src/feature.ts`. The embedded object and invoice
line-item schemas live under `src/entities/`; integration tests cover schema
validation, derived values, totals, references, and the declarative edit
screen.
