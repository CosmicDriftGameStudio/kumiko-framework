# Contributing to Kumiko

Thanks for your interest. This is a young project — we welcome PRs but ask
that you open an issue first to discuss the change. That keeps you from
investing time in something we're already building or have ruled out.

## Before you start

- Skim the [Kumiko docs](https://docs.kumiko.rocks) for the architecture and
  conventions in use.
- Check open issues — your idea may already be tracked.
- For substantial changes (new features, architectural shifts), please
  open a discussion issue **before** writing code.

## Setup

```bash
git clone git@github.com:cosmicdriftgamestudio/kumiko-framework.git
cd kumiko-framework
bun install
bun kumiko dev      # start Postgres + Redis
bun kumiko check    # full validation: Biome + TypeScript + Tests + Guards
```

`bun kumiko check` is what CI runs. If it's green locally, your PR will
likely be green in CI too.

## Conventions

- **Package manager:** `bun` — never `npm`/`npx`/`yarn`
- **No `any`** — concrete types or branded types only
- **TypeScript strict mode** — `noUncheckedIndexedAccess` is on, deal with it
- **Tests are not optional.** Every feature change ships with tests:
  - Recipe-level changes need a recipe test
  - Framework changes need integration tests, not unit tests with mocks
  - Mocking the dispatcher / DB in `*.integration.ts` is blocked by guards
- **Each new framework feature needs a sample** in `samples/recipes/` or
  `samples/apps/`. Samples are tested documentation — without one, the
  feature is not done.
- **Commit messages:** use conventional prefixes (`feat:`, `fix:`, `cleanup:`,
  `docs:`, `refactor:`). Subject line under 70 chars, body explains the *why*.

## What gets merged

- Bug fixes with a regression test
- Performance improvements with before/after numbers
- New features that have been discussed in an issue first
- Documentation improvements

## What doesn't get merged

- Code without tests (where tests are sensible)
- New dependencies without justification
- Stylistic refactors of code you don't otherwise touch
- Features that bypass the existing pipeline (auth, validation, audit)

## License

By contributing, you agree your contributions are licensed under the same
[BUSL-1.1](./LICENSE) terms as the rest of the project.

## Reporting security issues

Please **don't** open a public issue for security vulnerabilities. Email
marc@cosmicdriftgamestudio.com directly. We aim to respond within 5
business days.
