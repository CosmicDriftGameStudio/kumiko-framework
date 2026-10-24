---
"@cosmicdrift/kumiko-testing": minor
"@cosmicdrift/kumiko-bundled-features": patch
---

Dependency security update: happy-dom 21.0.4 (GHSA-834V-8H66-3H79) and undici 7.30.1 (GHSA-XJJ6-F33Q-929C).

<!-- kumiko-changes
feature: testing
type: breaking
title: happy-dom and undici updated for security advisories
migration: |
  Bump @happy-dom/global-registrator (and happy-dom, if listed) to ^21.0.4 in the app's devDependencies; the kumiko-testing peer range is now ^21.0.4. happy-dom 21 is a major release: run the app's DOM test suite after the bump.
detail: The happy-dom range for the global registrator and the DOM test setup moves to ^21.0.4 (fixes GHSA-834V-8H66-3H79, incomplete fix for an unsanitized import alias leading to host code execution), undici is pinned to 7.30.1 (fixes GHSA-XJJ6-F33Q-929C, denial of service through an unhandled error on excessive content-encodings).
-->
