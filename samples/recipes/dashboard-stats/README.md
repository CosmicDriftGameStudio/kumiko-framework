# Dashboard stats

Key figures on a dashboard. This recipe ships a `ticket` entity, one query
handler that returns the figures as a flat object, and a `dashboard` screen
with a stat group (open, closed) and a single stat (total).

The point is to show how the three pieces connect: the screen only names a
query and the fields to read, the query does the counting.

## What it shows

- **Panels reference a query by qualified name**: each `stat` carries
  `query: "tickets:query:ticket:stats"`. The dashboard calls that handler and
  renders the result.
- **`valueField` picks a field from a flat result**: the handler returns
  `{ open, closed, total }`, and each stat names one of those keys.
- **`stat-group` and `stat`**: a group shows several stats side by side under
  one title, a top-level `stat` stands alone.
- **Counting happens in the database**: the handler calls the executor's
  `list` with `filter`, `limit: 1` and `totalCount: true`. The total is counted
  over the whole WHERE clause, so no rows are loaded just to be counted.
- **Labels are translation keys**: declared with `r.translations`.

## When to reach for it

You want a landing screen with a few numbers: open items, overdue invoices,
this month's revenue. Write one query per screen that returns every figure,
and let the stats pick their field.

## Source

The whole feature lives in `src/feature.ts` (~100 lines). The integration test
checks that every stat reads a field the query returns, and that the query
counts open and closed tickets correctly.

```bash
bun kumiko test integration samples/dashboard-stats
```
