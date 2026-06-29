---
"@cosmicdrift/kumiko-framework": minor
---

Boot-validator: `entityList` rowAction/toolbarAction `navigate` targets may now resolve to a screen registered in ANY feature, not only the list screen's own feature. The runtime router already resolves a bare screen id app-wide across all features, so a declarative list that lives in the entity's owning feature can navigate to a consumer app's custom editor screens (e.g. a `credit`-feature list opening money-horse's `credit-calculator`/`bauspar-edit`). `redirect`/`cancelTarget` stay same-feature — their router builds the URL directly from the short id.
