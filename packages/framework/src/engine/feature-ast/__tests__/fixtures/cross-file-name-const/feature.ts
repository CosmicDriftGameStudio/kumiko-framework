import { EXT_AUDIT } from "./constants";

// biome-ignore lint/suspicious/noExplicitAny: structural parser test fixture, never executed or type-checked at runtime
declare function defineFeature(name: string, setup: (r: any) => void): void;

defineFeature("cross-file-name-const", (r) => {
  r.extendsRegistrar(EXT_AUDIT, {});
});
