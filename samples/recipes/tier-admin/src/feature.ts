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
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";

// --- App caps ---
//
// Each app picks its own cap dimensions. Here a tiny example: how many
// notes a tenant may keep. The TierMap is generic in this cap-shape so
// downstream code stays type-safe end-to-end.

export type AppCaps = { readonly maxNotes: number };

// --- The toggleable feature a paid tier unlocks ---
//
// A `r.toggleable()` feature shows up in a tenant's effective-features set
// exactly when its tier lists it. "pro" lists it below; "free" does not.
// This is what makes the cache-sync invariant observable: granting "pro"
// must light this feature up in the resolver the same request, not after a
// refresh, replay, or restart.

export const NOTES_EXPORT_FEATURE = "notes-export";

export const notesExportFeature = defineFeature(NOTES_EXPORT_FEATURE, (r) => {
  r.toggleable({ default: false });
});

// --- Tier map ---
//
// "free" + "pro" — the operator picks one of these names when granting
// a tier manually. "pro" unlocks the notes-export toggleable feature; the
// integration test grants "pro" and then reaches that feature in the same
// request, proving the cache-sync invariant end-to-end.

export const appTierMap: TierMap<AppCaps> = {
  free: { features: [], caps: { maxNotes: 5 } },
  pro: { features: [NOTES_EXPORT_FEATURE], caps: { maxNotes: 100 } },
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
