// Schema-Barrel für use-all-bundled.
//
// Zwei Quellen wie bei Studio:
//   schema-tables-auth-mode  — Framework-Infra + Bundle-Custom-Tables.
//   schema.generated          — Entity-Tables aller bundled-features
//                               via buildEntityTable (siehe generate.ts).

export * from "@cosmicdrift/kumiko-dev-server/schema-tables-auth-mode";
export * from "./schema.generated";
