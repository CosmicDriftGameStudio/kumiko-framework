# WriteForm Section

Register a `projectionDetail` screen with a `kind: "writeForm"` section: a
self-persisting form embedded inside a record detail page, next to the
established `entityEdit` form for the same fields — so the two form kinds'
shared chrome (footer, submit button) can be compared side by side.

## What it shows

- `note-edit`, an `entityEdit` screen with one `title`/`category`/`priority`/
  `body` section
- `note-detail`, a `projectionDetail` screen whose only section is
  `kind: "writeForm"` with the identical field set, dispatching its own
  `note-desk:write:note:comment` handler on submit
- an e2e layout-parity spec (`e2e/writeform-parity.spec.ts`) proving both
  submit buttons render the same width, sit right-aligned in their form's
  footer, and never stretch full-width — the regression this recipe guards
  against (fw#2681)

## Source

Feature entry point: `src/feature.ts`.

## Tests

```bash
cd samples/recipes/writeform-section
bun test
bun run e2e         # layout-parity spec + regenerates the committed screenshot
```
