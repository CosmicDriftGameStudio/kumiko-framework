---
"create-kumiko-app": minor
"@cosmicdrift/kumiko-dev-server": minor
---

UX-polish for `bun create kumiko-app` based on the first end-to-end smoke
against `https://kumiko.rocks/install.sh`:

- **Next-steps points at `bun dev`** (not the CI-only `bun run boot` smoke).
  Also reminds the user that PG + Redis need to be up (`docker compose up -d`)
  and adds a one-line description so the recommended command is obvious.
- **Setup-impact preview**: a single `→ Scaffolding N features into ./<name>/`
  line lands before the actual file writes, so the user can correlate the
  picked feature count with what they selected.
- **README lists the mounted features dynamically** (`## Mounted features`
  with the picker output) instead of the hardcoded `secrets + sessions`
  foundation paragraph. Makes the generated README usable as a starting point
  doc rather than something the user immediately rewrites.

Deferred to a follow-up: `configurableOptions` sub-prompts (Plan-Doc D9
sketch). Only `auth-email-password` declares them today, and it's
auto-mounted via `includeBundled` rather than picker-mounted — wiring
sub-prompts requires deciding whether to surface auto-mounted features
in the picker or to annotate more picker-mounted features first.
