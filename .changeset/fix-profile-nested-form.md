---
"@cosmicdrift/kumiko-bundled-features": patch
---

Fix a security bug in the `user-profile` bundled feature's `ChangePasswordSection` and `ChangeEmailSection`: since the `profile` screen became a declarative `projectionDetail` (fw#2312), both extension sections were nesting their own `<Form>` inside the host `<form>` RenderEdit renders for the singleton screen. Nested `<form>` elements are invalid DOM — React logs "`<form>` cannot contain a nested `<form>`" and the submit button falls back to a native GET submission of the *outer* form instead of dispatching, putting the entered password(s) in the URL query string (visible in browser history, the `Referer` header, and any proxy/server access log; `ChangePasswordSection` leaks both the old and the new password).

Both sections now follow the same pattern `write-form-section.tsx` uses for the same problem: no nested `<form>`, a plain `type="button"` that calls the write dispatcher directly on click. testIds are unchanged. Enter-to-submit inside these two sections is lost as an accepted trade-off (same one `write-form-section.tsx` already made) — not worth reintroducing a `<form>` (or an `onKeyDown` submit hack, which reproduces the same failure mode) to keep it.

Affects 0.241.0 (fw#2312, when the screen became declarative) through 0.243.0.
