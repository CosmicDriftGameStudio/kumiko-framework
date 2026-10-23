import { registerFooScreens } from "./screens";

// biome-ignore lint/suspicious/noExplicitAny: structural parser test fixture, never executed or type-checked at runtime
declare function defineFeature(name: string, setup: (r: any) => void): void;

defineFeature("cross-file-registrar", (r) => {
  r.requires("config");
  registerFooScreens(r);
});
