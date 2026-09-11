---
"@cosmicdrift/kumiko-bundled-features": minor
---

`crypto-shredding:write:forget-subject`'s record-subject path now consults the host entity's own `retention.strategy` before shredding a row: a `blockDelete` entity (legally mandated physical retention, e.g. ledger/invoice text) refuses the request instead of silently proceeding, and the refusal is audited via the existing `forget-denied` event. This closes the operator-path gap from kumiko-framework#2596/#2789 — a DPO/SystemAdmin can now target a single row that structured mentions never found, with the retention check and the Art. 17 runbook documented in `docs/reference/crypto-shredding-row-subject.md`.
