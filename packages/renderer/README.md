# @cosmicdrift/kumiko-renderer

React renderer for Kumiko screens: primitives contract, hooks, `KumikoScreen`, navigation and SSE abstractions. The root entry has no DOM and no `EventSource`; the subpaths add the web bindings (`/web`), UI logic (`/headless`) and the HTTP dispatcher (`/live`).

## Install

```bash
bun add @cosmicdrift/kumiko-renderer
```

Import the browser bindings from `@cosmicdrift/kumiko-renderer/web`.

Documentation: https://kumiko.rocks
