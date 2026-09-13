---
"@cosmicdrift/kumiko-renderer-web": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

Fix consumer typecheck failures against the published package: `@types/qrcode` was only in `devDependencies`, but both packages publish their `.tsx` sources (typechecked by consumers) and import the runtime `qrcode` package. Consumers don't install `devDependencies`, so `qrcode`'s missing type declarations broke their typecheck (`TS7016`/`TS7006` in `primitives/index.tsx`, introduced by #2840). Moved `@types/qrcode` to `dependencies` in both packages.
