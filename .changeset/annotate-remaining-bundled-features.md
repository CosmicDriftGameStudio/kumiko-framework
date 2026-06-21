---
"@cosmicdrift/kumiko-bundled-features": minor
"create-kumiko-app": minor
---

Annotate all remaining bundled features with `r.uiHints`

Twenty-seven features that previously had no `uiHints` block now carry a
`displayLabel` + `category` + `recommended` flag. They show up in the
`create-kumiko-app` picker grouped by category (identity, infrastructure,
storage, notifications, billing, compliance, operations, content, data) —
the picker no longer hides them as "not yet annotated".

`create-kumiko-app`'s `FEATURE_CONSTRUCTORS` map gains an entry for every
zero-arg constructor: 35 features total are now selectable. Features that
need caller-supplied args (channel-email, channel-push, file-provider-s3,
managed-pages, subscription-mollie, subscription-stripe, tier-engine)
remain absent from the constructor map — the picker hides them because
the scaffolder can't synthesize the required transport/provider config.
Wire them by hand after scaffolding.

Refreshed the vendored `feature-manifest.json` so the picker reads the
new hints out of the box.
