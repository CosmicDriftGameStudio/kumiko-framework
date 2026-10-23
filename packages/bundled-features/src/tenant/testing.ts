// `/testing` re-exports `/seeding`; it is no longer the home of the seed helpers.
// The helpers live in `/seeding` because they are also consumed by the
// development-server bootstrap (`runDevApp`), not only by tests. Keep their
// stable contract here; test-specific options do not belong in this module,
// because they could break development boots when a lockout-test option is added.

export * from "./seeding.ts";

export * from "./testing-event-store.ts";
