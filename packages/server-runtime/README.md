# @cosmicdrift/kumiko-server-runtime

Production server boot for Kumiko apps: connections, schema drift gate, seeds, lifecycle and graceful shutdown. The prod counterpart to `runDevApp` in `@cosmicdrift/kumiko-dev-server`, without dev, scaffold or codegen tooling.

## Install

```bash
bun add @cosmicdrift/kumiko-server-runtime
```

```ts
import { runProdApp } from "@cosmicdrift/kumiko-server-runtime/run-prod-app";
```

Documentation: https://kumiko.rocks
