# apex-landing

A marketing landing page that **composes its content from other features**:
the hero copy comes from `text-content`, the prices and plan caps come from
`tier-engine`. `renderApexPage` turns the assembled page into one static,
cacheable HTML string — zero React, one HTTP response.

The point of the recipe: a landing page is not a place to hard-code copy and
prices. Pull them from the features that already own that data and the page
can never drift from the product.

## The two seams

```ts illustration
// hero copy ← text-content: block body if seeded, else a baked-in fallback
title: block(input.blocks, "index:hero.title", "Ship your roadmap, …"),

// prices/caps ← tier-engine: one plan from the config → one pricing card
tiers: input.plans.map(toPricingTier),
```

`block(slug, fallback)` reads the `text-content` projection; omit a slug and
the fallback renders, so the page is complete before anything is seeded.
`toPricingTier(plan)` maps a `tier-engine` plan (price, cap, benefits) onto an
`ApexPricingTier`. See `src/feature.ts` for the full assembly.

## Screenshot renderer

`bun run screenshot` renders the sample page and shoots a full-page PNG via
Playwright (`page.setContent` — no server, because the renderer is pure). The
docs guide embeds that PNG, so the image is always the real output.

## Run

```bash
bun test            # both seams: block fallback + price/cap formatting
bun run screenshot  # → screenshots/landing.png
```
