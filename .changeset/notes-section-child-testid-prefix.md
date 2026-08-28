---
"@cosmicdrift/kumiko-bundled-features": minor
---

**Breaking:** `NotesSection`'s per-note child `testId`s no longer share the row's `data-testid` prefix. A consumer selecting rows via `[data-testid^="notes-section-row-"]` previously matched 3 nodes per note (row + body + meta) instead of 1 — silent, since the assertion just looked like polluted test data. `notes-section-row-${id}-body` is now `notes-section-body-${id}`, and `notes-section-row-${id}-meta` is now `notes-section-meta-${id}`. The row id itself (`notes-section-row-${id}`) is unchanged. No consumer in this workspace addresses the old child ids directly.
