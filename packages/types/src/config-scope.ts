// Canonical source — packages/framework/src/engine/constants.ts's
// ConfigScopes value object is `satisfies Record<string, ConfigScope>`
// against this type, so adding a scope only here (or only there) is a
// compile error instead of silent drift (#1423/#1439).
export type ConfigScope = "system" | "tenant" | "user";
