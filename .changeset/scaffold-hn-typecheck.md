---
"@cosmicdrift/kumiko-dev-server": patch
"create-kumiko-app": patch
---

Scaffolded apps now typecheck cleanly out of the box.

- Add `@types/react` + `@types/react-dom` to the generated app's devDependencies (fixes ~900 TS7xxx errors from untyped React/JSX).
- Generated `src/client.tsx` wraps `DefaultAppShell` in a local `AppShell` that supplies the required `brand` prop, so `createKumikoApp({ shell })` typechecks against the renderer signature (fixes the TS2322 "Property 'brand' is missing" errors).
- Post-create next-steps banner is now English.
