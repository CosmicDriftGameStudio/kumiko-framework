---
"@cosmicdrift/kumiko-framework": patch
---

projection-rebuild: recover late-committing lower-id events under the fence (#443). bigserial assigns event ids pre-commit (id-order ≠ commit-order), so a concurrent cross-aggregate write could commit a lower id after the unlocked catch-up advanced past it; the fenced final drain (`WHERE id > cursor`) then skipped it permanently, silently losing it from the projection. The fence makes the subscribed-event set final, so the rebuild now count-rechecks against it and — only on a detected shortfall — rebuilds the shadow from scratch and replays the full log, with no double-apply and no cost on the common path.
