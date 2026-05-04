// Tier-Map fuer das cap-billing-demo. Source-of-Truth fuer welcher
// Tier wieviel darf — die feature.ts liest das hier zur Cap-Auflösung.
//
// **Design-Wahl:** alle Tiers mounten dieselben Features (mail-
// foundation + cap-counter + newsletter). Der Tier-Unterschied steckt
// AUSSCHLIESSLICH in den Caps. So sehen Demo-User: gleicher Code-Pfad,
// unterschiedliche Limits — exakt das Pattern, das eine echte Plattform
// zwischen Free und Pro fährt.

import type { TierMap } from "@kumiko/bundled-features/tier-engine";

/**
 * Cap-Shape der Demo-App. Zwei Caps:
 *   - newslettersPerMonth: Calendar-Period-Cap (1.-eines-Monats Reset)
 *   - aiSummariesPer7Days: Rolling-Window-Cap (Drift-pin: zeigt dass
 *     beide Cap-Profile parallel funktionieren — auch wenn der
 *     Demo-Code aiSummaries gerade nicht implementiert)
 */
export type DemoCaps = {
  readonly newslettersPerMonth: number;
  readonly aiSummariesPer7Days: number;
};

export const DEMO_TIER_MAP: TierMap<DemoCaps> = {
  free: {
    features: [],
    caps: {
      // Bei limit=10: soft@11 (1.1×), hard@12 (1.2×). Demo-Test feuert
      // 11× → soft-hit, 12× → hard-block. Saubere Bands für die Story.
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
