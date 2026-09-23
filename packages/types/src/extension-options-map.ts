// Cross-Feature Compile-Time-Type-Map for `r.useExtension(name, entity, options)`.
// Augmented per extension point via `declare module "@cosmicdrift/kumiko-framework/engine"`,
// mirroring event-type-map.ts; names without augmentation stay untyped.

import type { EscapeHatchDeclaration } from "./handlers";

// MUST be `interface` (not `type`): only interfaces support TS declaration-
// merging. See event-type-map.ts for the same constraint.

// biome-ignore lint/suspicious/noEmptyInterface: declaration-merging marker — augmented per extension point
export interface KumikoExtensionOptionsMap {}

/** Options shape for an extension name: the augmented hook shape plus `escapeHatch`, or an untyped bag if unaugmented. */
export type ExtensionOptionsFor<N extends string> = N extends keyof KumikoExtensionOptionsMap
  ? KumikoExtensionOptionsMap[N] & { readonly escapeHatch?: EscapeHatchDeclaration }
  : Record<string, unknown>;
