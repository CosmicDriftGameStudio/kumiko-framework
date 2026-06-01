---
"@cosmicdrift/kumiko-dev-server": patch
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-framework": patch
---

Fix a batch of "wrong-api" issues surfaced in PR review:

- **`runProdApp` boot-path now reads the injected `envSource`, not the real
  `process.env`.** `requireEnv`/`readEnv`, the `PORT` read, and the
  `KUMIKO_SKIP_ES_OPS` guard all thread the validated env-source (default
  `process.env`), so a caller injecting env (tests / mirrored boot) fully
  controls configuration instead of silently picking up ambient values.
- **`set-custom-field` embedded validation is now type-shape only.** Embedded
  sub-fields had their `required`/`maxLength`/`format`/`default` constraints
  stripped at the top level but not per sub-field, so a required sub-field
  still rejected missing/empty values — contrary to the documented
  "type-mismatches and ONLY type-mismatches" contract. Embedded values with a
  missing or empty required sub-field are now accepted (the constraint is
  enforced elsewhere, not at set-time), matching the top-level behavior.
- **`useExtensionSectionComponent(name?)` accepts an optional name**, mirroring
  `useColumnRenderer`, so callers can invoke the hook unconditionally without
  passing a `""` stub.
- **`kumiko init-deploy` scaffolds into `ctx.cwd`** (not `process.cwd()`) and
  derives the displayed paths via `node:path` `relative(ctx.cwd, …)`, so the
  write target and the printed paths share one root under injected working
  directories.
- Generated dev-app comment uses the valid `bunx kumiko dev` invocation.
