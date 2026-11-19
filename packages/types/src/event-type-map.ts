// Compile-time event type map: an app augments KumikoEventTypeMap through
// `declare module "@cosmicdrift/kumiko-framework/engine"` so ctx.events.append checks the
// event type and payload in the editor. Without an augmentation append accepts no event
// type; emit through emitEvent(ctx, eventDef, ...) or ctx.events.unsafeAppend instead.
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
