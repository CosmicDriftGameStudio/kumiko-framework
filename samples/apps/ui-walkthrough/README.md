# UI Walkthrough

Browser live-viewer for Kumiko's ui-core logic layer. No React, no
renderer — raw HTML inputs on the left, live JSON panels on the right
showing:

- the form-controller's snapshot (values, changes, errors, field-states)
- the output of `computeEditViewModel` (label, visible, readOnly, required)
- the dispatcher-live result when you click Submit

## Run

```
yarn install            # once
bun run samples/ui-walkthrough/src/server.ts
```

The server prints the URL it landed on (default `http://localhost:4173`
— set `PORT` in your shell to override).

## What to try

- Type into **Title** — watch `snapshot.changes.title` and
  `snapshot.isDirty` flip.
- Leave **Title** empty and click **Submit** — `validate()` fails,
  `snapshot.errors.title` populates, no network call fires
  (`validationBlocked: true` in the result panel).
- Tick **Is urgent** — the `notes` row appears and gains a red
  asterisk; the view-model now shows
  `{ field: "notes", visible: true, required: true }`.
- Submit with urgent + empty notes — `superRefine` flags the issue; it
  lands under `snapshot.errors.notes`.
- Submit with valid values — `isSuccess: true` comes back from the
  in-memory echo server, snapshot rebases to the submitted values, and
  `isDirty` goes quiet.

## What's echoed

The dev server (`src/server.ts`) is not a real Kumiko stack — it only
bundles `client.ts` for the browser and echoes `POST /api/write` back
in Kumiko's success-envelope shape. The CSRF double-submit check is
real; the auth pipeline is not.

The real thing lands in M2 when the renderer and the full
`createApp()` stack wire together; this sample retires then.
