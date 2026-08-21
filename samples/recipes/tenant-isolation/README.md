# Tenant Isolation

Multi-tenant data isolation by default.

## What it shows

- Tenant filter on ordinary handlers
- What breaks if you forget tenancy (and how the framework prevents it)

## Source

Feature entry point: `src/feature.ts`.

## Tests

```bash
cd samples/recipes/tenant-isolation
bun test
```
