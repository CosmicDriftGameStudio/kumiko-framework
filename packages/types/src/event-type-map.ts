// Cross-Feature Compile-Time Type Map.
//
// Purpose: check ctx.events.append / ctx.dispatch.queryProjection / dispatcher.write against a
// statically known schema image instead of failing only at boot or runtime
// (zod-validate). The Designer/AI layer benefits immediately: autocomplete knows all
// event types from all loaded features, and payload-shape mismatches appear in the
// editor rather than only at boot.
//
// Each feature populates the map through `declare module "@cosmicdrift/kumiko-framework/engine"`
// — either manually (for stable framework internals) or through the code-generation
// script (for apps/bundled-features). Empty defaults are not a bug: a feature without
// augmentation is runtime-pluggable and uses the fallback overload with `unknown`
// payload.
//
// Pattern for a manually written augmentation at the top of the file:
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
