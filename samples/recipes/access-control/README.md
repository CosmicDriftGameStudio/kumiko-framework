# Access Control

Default-deny access rules and FK indices via relations.

## What it shows

- Handler `access` roles as the default-deny gate
- Relation-declared FK indices for join-friendly schemas

## Source

Feature entry point: `src/feature.ts`.

## Tests

```bash
cd samples/recipes/access-control
bun test
```
