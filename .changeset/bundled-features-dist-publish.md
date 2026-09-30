---
"@cosmicdrift/kumiko-bundled-features": patch
---

kumiko-bundled-features is published as compiled JavaScript plus .d.ts

`kumiko-bundled-features` now ships `dist` (`.js` and `.d.ts`) instead of TypeScript source. Export keys are unchanged; only the targets behind them move to `dist`. The per-feature `changes.json` files stay in the tarball as source, because `kumiko upgrade` and `kumiko changes` read them from the installed package. The package now declares `jose`, `temporal-polyfill`, `uuid` and `zod` as dependencies, which its code already imported. `template-resolver/testing` needs Bun (it imports `kumiko-framework/testing`). The MFA setup screen imports `qrcode/lib/browser.js` with its extension so Node's ESM resolver finds it.

<!-- kumiko-changes
feature: auth-mfa
type: improvement
title: kumiko-bundled-features is published as compiled JavaScript plus .d.ts
-->
