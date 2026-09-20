# @cosmicdrift/kumiko-testing

Test template for Kumiko apps. Test-only: never import it from production code.

```ts
import { seedTenant, setupAppTestStack } from "@cosmicdrift/kumiko-testing";

const stack = await setupAppTestStack([myFeature]);
const tenant = await seedTenant(stack, { users: 2 }); // light: no rows, own id/key/users
const persisted = await seedTenant(stack, { persist: true }); // real rows via the dispatcher
await tenant.api.writeOk("my-feature:write:thing:create", { title: "x" });
```

- `preload/{temporal,ci-log,scrub-env,env,real}`: bunfig `preload` entries. `scrub-env` removes
  `PROVIDER_ENV_KEYS` (unit default); `env` adds the localhost service defaults (integration);
  `real` refuses to run without `KUMIKO_REAL_PROVIDERS=1` and in CI, and keeps the keys.
- `kumiko-testing bunfig [--dom] [--coverage]`: writes `bunfig.toml`,
  `bunfig.integration.toml` and `bunfig.real.toml` (plus `bunfig.dom.toml`). `--dom` needs your own
  `./test-setup/dom.preload.ts`.
- `kumiko-testing integration [--parallel N] [--timings <file>]`: runs `*.integration.test.ts`
  with the 15s budget. No `--no-isolate`; `--parallel` only when you ask for it.
