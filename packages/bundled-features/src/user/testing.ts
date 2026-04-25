// /testing re-exportiert /seeding. Siehe ../tenant/testing.ts für die
// Begründung — Helpers sind shared zwischen Tests und Dev-Server-
// Bootstrap, /seeding ist die stabile Heimat.

export * from "./seeding";
