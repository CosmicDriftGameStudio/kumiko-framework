# Wizard form

An `entityEdit` screen with `EditLayout.mode: "wizard"` — one section per
step instead of one long form. The final step is a review section
(`kind: "extension"`) that reads the wizard's live values instead of
re-fetching them, and `draft: true` resumes an abandoned wizard from where
the user left off.

## What it shows

- **`mode: "wizard"`** — the same three sections a `"single"` layout would
  render all at once instead render one per step, with a progress
  indicator and per-step validation. The boot-validator requires at least
  two sections, each with a non-empty `title`.
- **A review step as an extension section** — the third step
  (`kind: "extension"`) mounts `ListingReviewSection`, a client component
  resolved by the `__component` name at render time. It receives the host
  form's current values through `ExtensionSectionProps.values` (the same
  live snapshot the other steps edit) and renders them read-only via
  `DetailList` — no second fetch, no duplicated state.
- **`draft: true`** — persists the in-progress wizard as a resumable draft.
  This flag only does two things in the feature: it requires
  `mode: "wizard"` and it requires the bundled `form-draft` feature to be
  mounted alongside this one (both enforced at boot). The actual
  save/resume/discard wiring happens automatically inside `RenderEdit` —
  this recipe never calls a form-draft handler from its own code.

## Feature composition

```
listing     — the entity being created through the wizard
form-draft  — bundled feature backing draft: true (mounted, never called
              directly by this feature — RenderEdit wires it client-side)
config      — form-draft requires this for its retention-days setting;
              mount createConfigFeature() alongside form-draft
```

## Flow

1. A user opens the `listing-wizard` screen and fills in the "Basics"
   step, then "Pricing".
2. If they navigate away mid-wizard, `RenderEdit` has already saved a
   draft under a client-minted `${screen.id}:new:${draftId}` key
   (sessionStorage-backed); reopening the same tab resumes those values
   instead of starting over. A new tab has no `draftId` yet — it falls
   back to `form-draft:query:list` and either auto-adopts a single
   in-progress draft or offers a picker when there's more than one.
3. On the "Review" step, `ListingReviewSection` reads the values entered
   so far straight from the host form and displays them read-only — no
   extra network round-trip.
4. Submitting creates the `listing` through the standard CRUD create and
   discards the draft.

## When to reach for it

A form is long enough that one page of fields overwhelms the user, or
losing everything on an accidental tab close is a real cost — onboarding,
a multi-part application, anything a user is likely to fill in over more
than one sitting. Use a `"single"`-mode layout instead when the form is
short enough to fit on one screen; wizard mode's per-step validation and
draft persistence are overhead a short form doesn't need.

## Source

The feature entry point is `src/feature.ts`; the review-step component is
`src/web/listing-review-section.tsx`. `src/web/index.ts` exports
`listingsClient`, a `ClientFeatureDefinition` that registers
`ListingReviewSection` under the `__component` name `feature.ts`'s review
section points at — an app mounting this recipe must include
`listingsClient` in `createKumikoApp`'s `clientFeatures`, or the review
step falls back to `RenderEdit`'s unregistered-extension placeholder
instead of rendering the real component. The integration test under
`src/__tests__/` covers the entity's CRUD create through the wizard's
fields and the form-draft save/get/discard round-trip that backs
`draft: true`. `e2e/wizard.spec.ts` is a Playwright spec against the real
client bundle (mounted via `listingsClient`, the same registration an app
would use) — step navigation, per-step validation blocking Next on empty required fields,
draft-resume after a page reload, and that a successful submit discards
the draft (reopening the wizard starts fresh on step 1).
