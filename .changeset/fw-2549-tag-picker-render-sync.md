---
"@cosmicdrift/kumiko-bundled-features": patch
---

fw#2549: `TagPicker` syncs its buffered selection on the open transition instead of in a `value`-keyed `useEffect`. Both call sites (`TagSection`, `TagFilter`) derive `value` as a fresh array on every render, so any parent re-render while the picker was open — a refetch, a busy flag, an error banner — silently reset the buffer and discarded the user's in-flight selection. The reset now happens only when the modal actually (re)opens, which is what the picker always intended. Drops the last `no-raw-hooks` lint ignore in the tags feature.
