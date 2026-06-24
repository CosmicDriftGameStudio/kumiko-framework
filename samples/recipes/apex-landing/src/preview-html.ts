import { type ContentBlocks, renderLanding, SAMPLE_PLANS } from "./feature";

/** Seeded text-content blocks — shows the hero/meta seam with real copy, not fallbacks. */
export const PREVIEW_BLOCKS: ContentBlocks = new Map([
  ["index:hero.title", "Ship internal tools without rebuilding auth every sprint"],
  [
    "index:hero.tagline",
    "Multi-tenant commands, realtime UI, and GDPR-ready defaults — compose features instead of wiring CRUD by hand.",
  ],
  ["index:meta.title", "Tasklane on Kumiko — plan, ship, and scale"],
  [
    "index:meta.description",
    "A docs-ready landing composed from text-content and tier-engine — prices and hero copy stay in sync with the product.",
  ],
]);

export function renderLandingPreview(): string {
  return renderLanding({ blocks: PREVIEW_BLOCKS, plans: SAMPLE_PLANS });
}
