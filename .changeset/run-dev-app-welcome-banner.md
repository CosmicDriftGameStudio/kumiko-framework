---
"@cosmicdrift/kumiko-dev-server": minor
---

`runDevApp({ welcomeBanner: true })` — first-run banner after boot

Adds an opt-in `welcomeBanner` option to `runDevApp`. When set, the
dev-server prints a small box-art banner with the listen URL, the
seeded admin login (when `auth.admin` is configured), a hint where to
edit features for hot-reload, and a docs link.

Default is off so existing apps keep their current quiet boot. The
scaffold template (`create-kumiko-app`) flips it on so the first
`bun dev` ends on something the user can click.

Pass an object (`welcomeBanner: { featuresDir, docsUrl }`) to override
the hint text. The `renderWelcomeBanner` helper is exported for callers
that want to render the same banner outside `runDevApp`.

Phase 1c (sub) of the create-kumiko-app plan.
