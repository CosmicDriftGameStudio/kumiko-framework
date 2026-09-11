---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-renderer-web": minor
---

fw#2750: `TreeAction` (the type behind `NavDefinition.createAction` and `.actions`, the "+" and hover-actions on a nav node) now carries `screen` as an alternative to `target` — the same `screen` XOR `target` polymorphism the node itself already has. `target` is now optional. Previously an action could only dispatch via `TargetRef` (the EditorPanel path), so an app with plain screen routes had no way to wire a "+" affordance to a normal route.

The boot validator (`validateNavs`) rejects a `createAction`/`actions[]` entry that sets neither or both of `screen`/`target`, and rejects a `screen` that isn't a registered screen QN — same error class as the node's own dangling-`screen` check.

`renderer-web`'s `NodeActions` renders a `KumikoLink` to the route for a `screen`-action and keeps the dispatch-button for a `target`-action, same look either way. Also fixed while touching this: the actions container was hard-pinned `right-7` to clear the collapse-chevron even on non-expandable nodes (the common case for a flat app nav), leaving a 28px gap; it now sits at `right-1` when the node has no chevron.
