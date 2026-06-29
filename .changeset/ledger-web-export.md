---
"@cosmicdrift/kumiko-bundled-features": minor
---

ledger: add a client-safe `@cosmicdrift/kumiko-bundled-features/ledger/web` entry exporting the QN constants (`LedgerHandlers`/`LedgerQueries`) plus the pure recurring helpers (`projectSchedule`, `mergeScheduleActuals`, `scheduleReference`) and types. The main `/ledger` entry re-exports the feature/handlers/executor (which pull bun-db/postgres), so a browser bundle that imported from there failed on Node builtins. Client screens (e.g. a rent-cashflow view) import the dispatch QNs + forecast/merge from `/ledger/web` and dispatch via the renderer — mirrors `/folders/web`.
