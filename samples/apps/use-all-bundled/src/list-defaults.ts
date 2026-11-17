import type { ListDefaultsOptions } from "@cosmicdrift/kumiko-framework/engine";

export const LIST_DEFAULTS = {
  table: {
    rememberState: true,
    resetAll: true,
    columnPicker: true,
    density: { userChoice: true },
    pinning: true,
    resizing: true,
    keyboardNavigation: true,
    export: { xlsx: true },
  },
  pinFirstColumn: true,
} as const satisfies ListDefaultsOptions;
