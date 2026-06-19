---
"@cosmicdrift/kumiko-framework": patch
---

Three config-feature test-coverage gaps from review, all behaviour-discriminating
(no fake/existence tests):

- inherited-redaction: the inheritance control test only seeded a `default`, so
  it proved default-fallback visibility — not that a SET system-row value is
  inherited by tenants (the actual non-redacted invariant). Added a control key
  whose seeded system-row value (42) differs from its default (5), asserting the
  tenant receives 42 (#376/2).
- app-override-visibility: the leak-guard test only asserted the value/source
  were `not` the leaked override, which stays green if the key drops out for
  another reason (e.g. access-deny). Added a positive `source === "missing"`
  anchor (#383/1).
- backing-secrets: the PR's central "throws loud, never silently degrades"
  promise for `backing="secrets"` keys had no test. Added one that wires the
  feature WITHOUT `ctx.secrets` and asserts `config:write:set` fails with
  `internal_error`/500 and writes no config_values fallback row (#387/2).
