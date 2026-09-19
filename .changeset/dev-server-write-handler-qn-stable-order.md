---
"@cosmicdrift/kumiko-dev-server": patch
---

renderWriteHandlerTypes emits the WriteHandlerQn union in stable order

`renderWriteHandlerTypes` now sorts `handlerQns` before rendering, like its sibling renderers in the same file. The dev-server passes registration order (`collectWriteHandlerQns`) while the CLI/build path passes manifest order, so the same feature set produced a differently ordered `WriteHandlerQn` union in `.kumiko/define.ts` and `.kumiko/types.generated.d.ts` depending on which one ran last. Consumer apps that commit those generated files no longer get order-only diffs after a local `bun dev`.

<!-- kumiko-changes
feature: dev-server
type: fix
title: renderWriteHandlerTypes emits the WriteHandlerQn union in stable order
-->
