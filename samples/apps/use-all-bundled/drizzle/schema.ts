// Drizzle-Schema-Barrel für use-all-bundled.
//
// Zwei Quellen wie bei Studio:
//   drizzle-tables-auth-mode  — Framework-Infra + Bundle-Custom-Tables.
//   schema.generated          — Entity-Tables aller bundled-features
//                               via buildDrizzleTable (siehe generate.ts).

export * from "@cosmicdrift/kumiko-dev-server/drizzle-tables-auth-mode";
export * from "./schema.generated";
