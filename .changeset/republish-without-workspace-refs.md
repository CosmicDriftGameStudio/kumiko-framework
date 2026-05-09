---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-dev-server": patch
"@cosmicdrift/kumiko-headless": patch
"@cosmicdrift/kumiko-dispatcher-live": patch
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-renderer-web": patch
---

Re-publish 0.2.1 → 0.2.2 mit korrekt aufgelösten cross-package-Versionen.
0.2.1 hatte `workspace:*` als Wert in den dependencies (npm publish ohne
yarn-pack rewrite), Konsumenten bekamen "Workspace not found".

publish-with-oidc.sh nutzt jetzt `yarn pack` (rewrited workspace:*) +
`npm publish <tarball>` (OIDC + provenance).
