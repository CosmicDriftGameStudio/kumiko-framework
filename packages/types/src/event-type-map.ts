// Cross-Feature Compile-Time-Type-Map.
//
// Zweck: ctx.appendEvent / ctx.queryProjection / dispatcher.write gegen ein
// statisch bekanntes Schema-Bild prüfen, statt erst zur Boot- oder Runtime
// (zod-validate) zu scheitern. Designer/AI-Layer profitiert dadurch sofort:
// Autocomplete kennt alle Event-Typen aller geladenen Features, payload-
// Shape-Mismatches werden im Editor angezeigt, nicht erst beim Boot.
//
// Befüllung erfolgt per Feature über `declare module "@cosmicdrift/kumiko-framework/engine"`
// — entweder hand-geschrieben (für stabile Frameworks-Internals) oder vom
// Codegen-Skript erzeugt (für apps/bundled-features). Empty defaults sind
// kein Bug: ein Feature ohne Augmentation ist runtime-pluggable und nutzt
// die Fallback-Overload mit `unknown` payload.
//
// Pattern für hand-geschriebene Augmentation am File-Top:
//
//   declare module "@cosmicdrift/kumiko-framework/engine" {
//     interface KumikoEventTypeMap {
//       "users:user.created": z.infer<typeof userCreatedSchema>;
//     }
//   }

// MUST be `interface` (not `type`): only interfaces support TS declaration-
// merging. Apps/features extend these via `declare module "@cosmicdrift/kumiko-framework/engine"`
// blocks. A `type X = {}` alias would silently break that augmentation channel.

// biome-ignore lint/suspicious/noEmptyInterface: declaration-merging marker — augmented per feature
export interface KumikoEventTypeMap {}

// biome-ignore lint/suspicious/noEmptyInterface: declaration-merging marker
export interface KumikoEntityTypeMap {}

// biome-ignore lint/suspicious/noEmptyInterface: declaration-merging marker
export interface KumikoHandlerPayloadMap {}

// biome-ignore lint/suspicious/noEmptyInterface: declaration-merging marker
export interface KumikoHandlerResultMap {}
