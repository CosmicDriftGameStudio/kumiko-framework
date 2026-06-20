// Tier Admin Sample
//
// Shows the SystemAdmin-only operator flow: assigning a tier to *any*
// tenant without a billing purchase. The app side is intentionally tiny —
// the recipe is the bundled tier-engine itself, configured with the app's
// own TierMap. The integration test exercises the cross-tenant grant
// (set-tenant-tier), the read-back (get-tenant-tier returning
// source:"manual"), and the option-list (tier-options) end-to-end.

import {
  createTierEngineFeature,
  type TierMap,
} from "@cosmicdrift/kumiko-bundled-features/tier-engine";

// --- App caps ---
//
// Each app picks its own cap dimensions. Here a tiny example: how many
// notes a tenant may keep. The TierMap is generic in this cap-shape so
// downstream code stays type-safe end-to-end.

export type AppCaps = { readonly maxNotes: number };

// --- Tier map ---
//
// "free" + "pro" — the operator picks one of these names when granting
// a tier manually. `features` is empty in this sample because the recipe
// focuses on the grant flow; a real app would list the toggleable
// feature ids that the tier unlocks.

export const appTierMap: TierMap<AppCaps> = {
  free: { features: [], caps: { maxNotes: 5 } },
  pro: { features: [], caps: { maxNotes: 100 } },
};

// --- Configured tier-engine ---
//
// `defaultTier: "free"` means every new tenant starts on free via the
// `inTransaction` entity hook the tier-engine registers — no app code
// needed. `tierMap` makes `tier-options` return ["free", "pro"] so the
// tier-admin screen can populate its picker without hard-coding.

export const tierEngineForApp = createTierEngineFeature<AppCaps>({
  defaultTier: "free",
  tierMap: appTierMap,
});
