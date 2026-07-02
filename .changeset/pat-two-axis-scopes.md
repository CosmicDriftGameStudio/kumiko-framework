---
"@cosmicdrift/kumiko-bundled-features": minor
---

Personal Access Tokens: two-axis scopes (which API × permission level).

`PatScopeConfig` now maps each domain to `{ label, read[], write? }`; a token grants `"<domain>:<level>"` entries (e.g. `"credit:write"`) where `read` grants the read QNs and `write` grants read + write. The mount UI renders a per-domain level picker (no access / read / read & write) — mirrors GitHub fine-grained PATs. Supersedes the initial flat scope shape (no consumer had adopted it yet). The `personal-access-tokens` feature is now mounted in the `use-all-bundled` sample.
