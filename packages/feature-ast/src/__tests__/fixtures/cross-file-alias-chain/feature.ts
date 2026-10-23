import { ALIASED_EVENT_SHORT as EVENT_SHORT } from "./star-barrel";
import { registerAliasedScreens as registerScreens } from "./wrapper";

// biome-ignore lint/suspicious/noExplicitAny: structural parser test fixture, never executed or type-checked at runtime
declare function defineFeature(name: string, setup: (r: any) => void): void;

defineFeature("cross-file-alias-chain", (r) => {
  r.defineEvent(EVENT_SHORT, {}, { piiFields: "none" });
  registerScreens(r);
});
