import type { BundledListsOptions } from "@cosmicdrift/kumiko-framework/engine";

export const BUNDLED_LISTS = {
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
} as const satisfies BundledListsOptions;
