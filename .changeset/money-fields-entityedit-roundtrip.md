---
"@cosmicdrift/kumiko-headless": patch
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-renderer-web": patch
---

Fix #1923: money fields now round-trip correctly on the auto-wired
entityEdit path. Create previously sent a bare number against the server's
`{amount, currency}` schema, update rendered the rehydrated read value as
`NaN`, and a naive fix would have been 100x off for zero-decimal currencies
like JPY (minor vs. major units). `RenderField`'s money case now converts
between `MoneyInput`'s minor-unit widget contract and the major-unit
`{amount, currency}` payload/read shape via a shared `currencyDecimals`
(moved to `kumiko-headless`), and `EditFieldViewModel` carries the field's
resolved currency so the conversion has one source of truth.

Money fields declared on a `configEdit`/`actionForm` screen (not entityEdit)
still submit correctly: `ConfigEditBody`'s `customSubmit` unwraps the
`{amount, currency}` payload back to a bare number before dispatching
`config:write:set`, matching `ConfigKeyType`'s scalar-only contract.
