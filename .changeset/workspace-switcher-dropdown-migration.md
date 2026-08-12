---
"@cosmicdrift/kumiko-renderer-web": minor
---

`WorkspaceSwitcher` is now a dropdown instead of a row of tab buttons — a row overflowed the sidebar width with 3+ workspaces (or even 2 longer names), truncating and hiding the last entry entirely.

Consumer apps with their own tests/e2e against the old tab-row markup need to update:

- Click `workspace-switcher-trigger` first to open the dropdown before selecting a `workspace-tab-*` entry.
- `aria-selected` on the active tab is now `aria-checked` on the active `DropdownMenuCheckboxItem`.

Also fixes the trigger showing an empty label when `activeId` points at a workspace that isn't in the visible list (stale URL param after a role change) — it now falls back to a "Select workspace" placeholder instead of a blank button.
