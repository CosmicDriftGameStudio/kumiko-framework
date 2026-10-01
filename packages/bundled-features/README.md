# @cosmicdrift/kumiko-bundled-features

Built-in Kumiko features: tenant, user, auth, jobs, audit, delivery, billing and more. The pieces most apps rewrite anyway, already typed and tested.

## Install

```bash
bun add @cosmicdrift/kumiko-bundled-features
```

```ts
import { createJobsFeature } from "@cosmicdrift/kumiko-bundled-features/jobs";
```

Every feature is a subpath export (for example `@cosmicdrift/kumiko-bundled-features/tenant`) with a `create*Feature` factory or a ready-made feature value, and optional `/web` client plugins for the UI.

Documentation: https://kumiko.rocks
