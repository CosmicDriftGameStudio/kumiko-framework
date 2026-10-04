---
"@cosmicdrift/kumiko-server-runtime": patch
---

The prod and worker boot pass the app logger (`extraContext.log`) to the delivery service, so redacted delivery failures reach that logger instead of the console. `ctx.notify` is built with `createDeliveryNotifyFactory`. `buildBootExtraContext` accepts an optional `log`.

<!-- kumiko-changes
feature: server-runtime
type: fix
title: Delivery failures are logged to the app logger in prod
-->
