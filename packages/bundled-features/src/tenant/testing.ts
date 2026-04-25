// /testing re-exportiert /seeding. Ehemalige Heimat der seed-Helpers,
// jetzt nur noch Aggregation. Die Helpers leben in `/seeding` weil sie
// genauso vom Dev-Server-Bootstrap (runDevApp) konsumiert werden — nicht
// nur von Tests. Vertrag der Helpers ist stabil, test-spezifische
// Knöpfe gehören NICHT hier rein (würde dev-boots brechen wenn jemand
// einen lockout-test-Knopf einbaut).

export * from "./seeding";
