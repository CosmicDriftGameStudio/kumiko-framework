---
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-renderer-web": patch
---

fix(config-mask): cascade-disclosure usability (#429, #430)

#430: a config save now refetches values+cascade, so the Cascade-Disclosure
reflects the saved value immediately instead of staying stale until reload
(customSubmit previously only rebased the form state — onReset already refetched).

#429: the disclosure trigger moves into the field label row (right-aligned via
DefaultField's `flex justify-between`); the expanded detail renders between label
and input (directly under its trigger). A field that only shows its inherited
default is no longer expandable — no redundant single-row panel.
