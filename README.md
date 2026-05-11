# Kumiko

> **AI-native backend builder.** Prompt your domain — get the full backend: schema, auth, audit, multi-tenant, realtime. TypeScript, your repo, your code.

[![License: BUSL-1.1](https://img.shields.io/badge/License-BUSL--1.1-blue.svg)](./LICENSE) [![npm](https://img.shields.io/npm/v/@cosmicdrift/kumiko-framework.svg)](https://www.npmjs.com/package/@cosmicdrift/kumiko-framework) [![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue.svg)](https://www.typescriptlang.org/) [![Bun](https://img.shields.io/badge/Bun-runtime-black.svg)](https://bun.sh)

<details>
<summary>Other things people say about Kumiko</summary>

> **"With Kumiko, everything is faster!"** <sup>\*faster than building it all from scratch again without Kumiko. Sample size: n=1 (the author).</sup>
>
> **"90% of developers say: Kumiko makes everything faster."** <sup>\*we asked 10.</sup>
>
> **"Enterprise-ready since day one."** <sup>\*day one hasn't arrived yet.</sup>
>
> **"Battle-tested in production."** <sup>\*the production of demo samples.</sup>
>
> **"Multi-tenant out of the box."** <sup>\*box not included.</sup>
>
> **"Zero-config."** <sup>\*after the initial 47-step setup.</sup>
>
> **"Realtime with <1ms latency."** <sup>\*on localhost, Wi-Fi off, exactly one tenant named "test".</sup>
>
> **"Scales to millions of users."** <sup>\*theoretically, provided Postgres, Redis, Meilisearch, and your wallet all cooperate.</sup>
>
> **"Type-safe down to the last line."** <sup>\*`any` is also a type.</sup>
>
> **"Kumiko — because framework frameworks need a framework too."**

</details>

---

## What it does

You write:

```typescript
defineFeature("incident", (r) => {
  r.entity("incident", {
    fields: {
      title: { type: "text", required: true },
      severity: { type: "select", options: ["low", "high", "critical"] },
      status: { type: "select", options: ["open", "investigating", "resolved"] },
    },
  });

  r.writeHandler({
    name: "incident.open",
    schema: openSchema,
    handler: async (event, ctx) => {
      await ctx.appendEvent("incident-opened", { ...event });
    },
  });
});
```

You get, for free:

- **Multi-tenant scoping** — every entity is tenant-scoped by default
- **Audit trail** — every change is an event, time-travel queries work
- **Auth + sessions** — email/password, JWT, role-based access
- **Realtime updates** — SSE broadcast across tenants
- **CRUD UI** — schema-driven forms and lists with override paths
- **Type-safe everywhere** — no `any`, no magic strings

## Quickstart

### Prerequisites

- [Bun](https://bun.sh/) (server runtime)
- [Node.js](https://nodejs.org/) >= 20 (for Yarn)
- [Docker](https://www.docker.com/) (PostgreSQL + Redis)

### Setup

```bash
git clone git@github.com:cosmicdriftgamestudio/kumiko-framework.git
cd kumiko-framework
yarn install
```

### Run

```bash
# Interactive CLI — shows all commands
yarn kumiko

# Or directly:
yarn kumiko dev      # Start Docker services (PG:15432, Redis:16379)
yarn kumiko test     # Run unit tests
yarn kumiko check    # Biome + TypeScript + Tests + Guards
yarn kumiko status   # What's running?
yarn kumiko stop     # Stop services
yarn kumiko reset    # Wipe + restart everything

```

To explore feature patterns hands-on, run any sample:

```bash
cd samples/recipes/basic-entity
yarn test
```

## Why use this

- **Built for B2B SaaS / internal tools** — multi-tenant + audit are first-class, not afterthoughts
- **Postgres-native** — no Kafka, no EventStoreDB, no NATS. One database, one source of truth
- **AI-builder ready** — config-driven, every `r.*` call is patchable by AI tools
- **DACH/EU-ready** — self-host on Hetzner / k8s / bare-metal. BYO LLM (Anthropic, OpenAI, Ollama, vLLM)

## Architecture

| Layer | Tech |
|-------|------|
| Runtime | Bun |
| API | Hono |
| DB | Postgres + Drizzle ORM |
| Auth | jose (JWT) |
| Search | Meilisearch |
| UI | React + Expo (Web + Mobile) |
| Realtime | SSE via Redis Pub/Sub |
| Tests | Vitest |

Pipeline flow:

```
HTTP Request
  → JWT Auth (Hono middleware)
  → Dispatcher
    → Zod schema validation
    → Access check (entity-level roles)
    → Field-level write check
    → Validation hooks
    → Handler (CrudExecutor → DB)
    → Lifecycle pipeline:
        Feature postSave hooks
        System hooks (priority order):
          1000: Search index (Meilisearch)
          1001: SSE broadcast
          1002: Audit trail (DB)
  → Response (with field-level read filtering)
```

## Samples

Tested, runnable examples per feature. Three buckets:

- [`samples/recipes/`](samples/) — one concept = one feature definition + one test
- [`samples/apps/`](samples/) — full-stack demos with dev-server + browser client
- See the full sample index: [samples/README.md](samples/README.md)

## Live showcase

[publicstatus.eu](https://publicstatus.eu) — open-source statuspage clone built with Kumiko. Multi-tenant, SSE-realtime, deployed on Hetzner. Source: [github.com/cosmicdriftgamestudio/publicstatus](https://github.com/cosmicdriftgamestudio/publicstatus).

## Documentation

Full docs: [docs.kumiko.so](https://docs.kumiko.so).

## Status

Pre-1.0 — actively developed. APIs may change between minor versions until 1.0. Breaking-change policy and migration guides documented per release in [CHANGELOG.md](./CHANGELOG.md).

Used in production at [publicstatus.eu](https://publicstatus.eu).

## License

Business Source License 1.1 (BUSL-1.1) → Apache License 2.0 on **2030-05-05**.

You may use Kumiko in production for any purpose, **except** providing a platform or service to third parties that allows them to host, deploy, or run their own applications built with Kumiko. This includes managed hosting, SaaS platforms, PaaS, developer platforms, and any multi-tenant managed offering.

Code from any release automatically becomes Apache-2.0 four years after publication.

For commercial licensing or alternative arrangements: marc@cosmicdriftgamestudio.com.

Details: [LICENSE](./LICENSE).

## Hosted platform

Don't want to self-host? [kumiko.so](https://kumiko.so) is the hosted version with AI-builder, designer, and managed hosting.

## Contributing

PRs welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md) for setup + guidelines.

By contributing, you agree your contributions are licensed under the same BUSL-1.1 terms.

---

© 2026 Marc Frost — Cosmic Drift Game Studio.
