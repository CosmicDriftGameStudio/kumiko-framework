---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

Screens can now opt out of the AI agent with `agent: { expose: false }`, the same way handlers already could. A sysadmin-only or PII-heavy screen no longer has to carry an alibi `description` written solely to satisfy `agent-doc-lint` — the opt-out silences the lint gap AND removes the screen from the agent manifest, so it never reaches the `navigate` tool's screen-id enum or a nav entry pointing at it.

Every `ScreenDefinition` variant gains the optional `agent` slot (`@cosmicdrift/kumiko-types`), and `isAgentVisibleScreen` is exported from `@cosmicdrift/kumiko-framework/engine` alongside `resolveAgentExposure`.

The default is unchanged and deliberately not fail-closed: a screen without an `agent` slot stays visible to the agent whether or not it has a `description`, exactly as before. Only an explicit `expose: false` hides one.

Note the knock-on effect for `open_form`: an `actionForm` or `entityEdit` screen that opts out also loses its handler-to-screen mapping in the manifest, so the agent can no longer offer that form — the handler itself stays listed and directly callable.
