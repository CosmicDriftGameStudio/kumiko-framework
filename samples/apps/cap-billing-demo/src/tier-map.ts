// Tier map for the cap-billing-demo. Source of truth for which
// tier may do how much — feature.ts reads it here for cap resolution.
//
// **Design choice:** all tiers mount the same features (mail-
// foundation + cap-counter + newsletter). The tier difference lives
// EXCLUSIVELY in the caps. So demo users see: same code path,
// different limits — exactly the pattern a real platform
// runs between Free and Pro.

import type { TierMap } from "@cosmicdrift/kumiko-bundled-features/tier-engine";

/**
 * Cap shape of the demo app. Two caps:
 *   - newslettersPerMonth: calendar-period cap (reset on the 1st of the month)
 *   - aiSummariesPer7Days: rolling-window cap (drift pin: shows that
 *     both cap profiles work in parallel — even though the
 *     demo code does not implement aiSummaries yet)
 */
export type DemoCaps = {
  readonly newslettersPerMonth: number;
  readonly aiSummariesPer7Days: number;
};

export const DEMO_TIER_MAP: TierMap<DemoCaps> = {
  free: {
    features: [],
    caps: {
      // At limit=10: soft@11 (1.1×), hard@12 (1.2×). The demo test fires
      // 11× → soft-hit, 12× → hard-block. Clean bands for the story.
      newslettersPerMonth: 10,
      aiSummariesPer7Days: 0,
    },
  },
  pro: {
    features: [],
    caps: {
      newslettersPerMonth: 100,
      aiSummariesPer7Days: 50000,
    },
  },
};

/** Zwei Tier-Namen explizit als Type damit das tenant-tier-config
 *  validiert werden kann (z.B. via z.enum(TIER_NAMES)). */
export const TIER_NAMES = ["free", "pro"] as const;
export type TierName = (typeof TIER_NAMES)[number];
