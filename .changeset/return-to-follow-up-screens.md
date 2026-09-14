---
"@cosmicdrift/kumiko-renderer": minor
---

Follow-up screens return to the screen the user came from. List toolbar and row `kind: "navigate"` actions, the default "+ New" and edit actions, and detail/edit header navigate actions now add a `returnTo` search param naming the outermost screen (for a screen embedded in a dashboard panel: the dashboard). secretMint, actionForm and entityEdit use it instead of their declared `redirect`/`cancelTarget`/list fallback on submit, cancel and delete. A redirect to a record screen (entityEdit/projectionDetail) keeps precedence. Direct calls without the param behave as before. The param is only honored when it names a registered, accessible short screen id (optional entityId only for entityEdit/projectionDetail targets); anything else falls back to the declared target.
