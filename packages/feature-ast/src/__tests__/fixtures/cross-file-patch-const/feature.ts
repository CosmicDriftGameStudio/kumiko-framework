import { ENTITY_ITEM, EXT_TENANT_DATA } from "./constants";

// biome-ignore lint/suspicious/noExplicitAny: structural parser test fixture, never executed or type-checked at runtime
declare function defineFeature(name: string, setup: (r: any) => void): void;

defineFeature("cross-file-patch-const", (r) => {
  r.useExtension(EXT_TENANT_DATA, ENTITY_ITEM);
});
