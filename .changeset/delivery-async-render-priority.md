---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

delivery: decouple email rendering into chained jobs + map notify priority onto the job queue (#267)

- **Framework:** job handlers now receive the `jobRunner` on their context, so a job can dispatch a follow-up job (job→job chaining). `jobRunner.dispatch` accepts `meta.priority` and forwards it as the BullMQ job priority.
- **delivery:** queued-mode channels (email, push) now deliver asynchronously. Email runs through `delivery.render` → `delivery.send` so the expensive render step is isolated in its own worker and retries independently of the SMTP send; push (no render step) goes straight to `delivery.send`. inApp stays inline (DB insert + SSE). Without a `jobRunner` configured, queued channels fall back to synchronous inline delivery.
- **delivery:** `notify()` `priority` (`critical`/`normal`/`low`) now maps onto the BullMQ job priority (1/2/3), so critical notifications jump ahead of low-priority ones in the worker queue.
- **delivery:** `read_delivery_attempts` gains a `priority` column and a `queued` status; an async attempt transitions `queued` → `sent`/`failed` on one event stream.
