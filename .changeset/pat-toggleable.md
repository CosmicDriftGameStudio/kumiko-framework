---
"@cosmicdrift/kumiko-bundled-features": minor
---

personal-access-tokens: add `toggleable` option so the whole feature can be tier-gated via the tier-engine (mirrors ledger/tags). Pass `{ toggleable: { default: false } }` for fail-closed gating — PAT is then off until a tier lists `"personal-access-tokens"` in its features. Omitting the option keeps PAT always-on (no behaviour change for existing consumers).
