import type { ScreenDefinition } from "./types/screen.ts";

export type ScreenKind = ScreenDefinition["type"];
export type ScreenOfKind = {
  readonly [K in ScreenKind]: Extract<ScreenDefinition, { readonly type: K }>;
};
