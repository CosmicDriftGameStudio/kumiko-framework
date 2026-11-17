// Cross-Feature Compile-Time-Type-Map for `r.applyExtension({ name, entity, ...options })`.
// Augmented per extension point via `declare module "@cosmicdrift/kumiko-framework/engine"`,
// mirroring event-type-map.ts; names without augmentation stay untyped.

// An extension escapeHatch always means unsafeRaw, so it carries a reason only.
export type ExtensionEscapeHatchDeclaration = { readonly reason: string };

// MUST be `interface` (not `type`): only interfaces support TS declaration-
// merging. See event-type-map.ts for the same constraint.

// biome-ignore lint/suspicious/noEmptyInterface: declaration-merging marker — augmented per extension point
export interface KumikoExtensionOptionsMap {}

/** Options shape for an extension name: the augmented hook shape plus `escapeHatch`, or an untyped bag if unaugmented. */
export type ExtensionOptionsFor<N extends string> = N extends keyof KumikoExtensionOptionsMap
  ? KumikoExtensionOptionsMap[N] & { readonly escapeHatch?: ExtensionEscapeHatchDeclaration }
  : Record<string, unknown>;

/** Rest-tuple for an extension's options arg: required for an augmented name with required keys, optional otherwise. */
export type ExtensionOptionsArgs<N extends string> = N extends keyof KumikoExtensionOptionsMap
  ? Record<never, never> extends KumikoExtensionOptionsMap[N]
    ? [options?: ExtensionOptionsFor<N>]
    : [options: ExtensionOptionsFor<N>]
  : [options?: Record<string, unknown>];
