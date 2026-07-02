---
"@cosmicdrift/kumiko-framework": minor
---

Brand TenantDb method-form writes (#742). `ctx.db.insertOne`/`updateMany`/`deleteMany` now reject a branded `EntityTable` at compile time, exactly like the free-function `insertOne(db, table, …)` helpers already do — closing the gap where a projection could still be written past its event stream via the method form (a rebuild would wipe such eventless rows). Reads (`selectMany`/`fetchOne`) are unchanged, and raw `pgTable`s plus unmanaged entity metas stay writable. The only sanctioned direct-write bypass remains the `@cosmicdrift/kumiko-framework/testing` seam (`seedRow`/`seedRows`/`updateRows`/`deleteRows`).

Migration: route production method-form writes on managed entities through `createEventStoreExecutor(...).create/.update/.delete/.forget`; in tests, use the testing seam (or hold a throwaway fixture at the unbranded `TableColumns` view).
