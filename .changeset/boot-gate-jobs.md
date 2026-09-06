---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

New `bootGate: true` job flag — a job that actually gates a deploy.

- A `bootGate` job runs inline while the job runner for its lane starts, before cron schedules and `runOnBoot` enqueues. Its handler is awaited, so a throw rejects `start()` and with it `runProdApp`'s boot: the process exits before it ever reports ready. It runs on every start and is never deduped.
- `runOnBoot` is now documented for what it does: it only enqueues (fire-and-forget), and it dedupes on a fixed job id, so it runs at most once per Redis dataset — a boot job that already ran or failed is not retried on a later deploy. A throw there fails a queue job, never the boot.
- `bootGate` cannot be combined with `perTenant` or `concurrency: "sequential"` — both have re-enqueue paths that would let a gate pass without ever running the handler. The registry rejects those combinations at build time.

**Breaking for `legal-pages` consumers:** its boot check moves from `runOnBoot` to `bootGate`, which makes the documented "hard-fails production when the required blocks aren't seeded" promise true for the first time. Two failure modes that were previously swallowed by the fire-and-forget queue now abort the boot:

- **Missing required blocks — `NODE_ENV=production` only.** Outside production the check still only logs a warning, unchanged. In production, an app shipping without the required blocks seeded in `SYSTEM_TENANT` now fails to boot instead of serving a site without an imprint. Fix by seeding the required blocks (`seedTextBlock`), or by narrowing/emptying `requiredBlocks` in the feature options.
- **Missing `extraContext.templateResolver` — every environment.** The check has always thrown here; the throw is now visible. `runProdApp` and `runDevApp` wire `templateResolver` automatically, so this only affects bootstraps that call `createKumikoServer` directly. Fix by passing `extraContext: ({ db }) => ({ templateResolver: createTemplateResolverApi(db) })`.

The `seo` feature's boot check stays on `runOnBoot` — it promises no hard fail, and converting it would turn a warning into a boot abort for apps without a sitemap entry source.
