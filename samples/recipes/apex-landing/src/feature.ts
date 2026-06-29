// Apex landing page — composed from OTHER features' data.
//
// `renderApexPage(page)` is a pure function: a typed `ApexPage` in, one HTML
// string out. The interesting part is where that page's CONTENT comes from. An
// app does not hard-code its landing copy or prices — it pulls them from the
// features it already runs, so the marketing page can never drift from the
// product:
//
//   • hero headline / tagline  ← text-content  (editable blocks, keyed by slug)
//   • prices and plan caps     ← tier-engine   (the app's plan config)
//
// `buildLandingPage` below shows both seams. It takes the data those features
// expose and assembles an `ApexPage`; the app serves `renderApexPage(page)` as
// one static, cacheable response.

import {
  type ApexPage,
  type ApexPricingTier,
  renderApexPage,
} from "@cosmicdrift/kumiko-headless/apex";

// --- Inputs: shapes the surrounding features hand you -----------------------

/** Editable copy as the `text-content` feature projects it: a body string per
 *  stable slug. A real app fills this Map from the text-content read model. */
export type ContentBlocks = ReadonlyMap<string, string>;

/** One plan as the app's `tier-engine` config exposes it. */
export type PlanInfo = {
  readonly key: string;
  readonly name: string;
  readonly tagline: string;
  /** `null` = free or on-request; the renderer just shows the `amount` text. */
  readonly monthlyEur: number | null;
  /** Usage cap from the tier config; `Infinity` = unlimited. */
  readonly maxProjects: number;
  readonly benefits: readonly string[];
  readonly featured?: boolean;
};

export type LandingInput = {
  /** From `text-content`. Omit a slug and the baked-in fallback is used, so the
   *  page renders fully even before anything is seeded. */
  readonly blocks?: ContentBlocks;
  /** From `tier-engine`. */
  readonly plans: readonly PlanInfo[];
};

// --- The two feature seams --------------------------------------------------

/** text-content seam: block body if seeded, else the fallback baked in here. */
function block(blocks: ContentBlocks | undefined, slug: string, fallback: string): string {
  return blocks?.get(slug) ?? fallback;
}

function formatEuro(n: number): string {
  return `${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

function planAmount(plan: PlanInfo): string {
  if (plan.monthlyEur === null) return plan.key === "enterprise" ? "Let's talk" : "0 €";
  return formatEuro(plan.monthlyEur);
}

function planCap(plan: PlanInfo): string {
  return Number.isFinite(plan.maxProjects)
    ? `${plan.maxProjects.toLocaleString("en-US")} projects`
    : "Unlimited projects";
}

/** tier-engine seam: one plan from the config → one Apex pricing card. */
function toPricingTier(plan: PlanInfo): ApexPricingTier {
  const paid = plan.monthlyEur !== null;
  return {
    name: plan.name,
    tagline: plan.tagline,
    amount: planAmount(plan),
    priceSuffix: paid ? "/month" : undefined,
    featured: plan.featured,
    badge: plan.featured ? "Popular" : undefined,
    capLine: planCap(plan),
    benefits: plan.benefits,
    cta: {
      label: plan.key === "enterprise" ? "Contact us" : `Choose ${plan.name}`,
      href: plan.key === "enterprise" ? "/contact" : "/signup",
      variant: plan.featured ? "primary" : "secondary",
    },
  };
}

// --- Assembly ---------------------------------------------------------------

const FEATURE_ICON = {
  bolt: '<path d="M13 2 4 14h6l-1 8 9-12h-6z"/>',
  shield: '<path d="M12 3 5 6v6c0 4 3 7 7 9 4-2 7-5 7-9V6z"/><path d="m9 12 2 2 4-4"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
} as const;

const BRAND_TOKENS = `:root{
  --bg:#ffffff; --bg-card:#ffffff; --bg-muted:#f6f7f9;
  --border:#e6e8ec; --fg:#0f1729; --fg-muted:#475067; --fg-subtle:#6b7280;
  --primary:#4f46e5; --primary-hover:#4338ca; --primary-fg:#ffffff;
  --accent:#4f46e5; --accent-fg:#ffffff; --accent-hover:#6366f1;
  --status-ok:#16a34a; --shadow:0 12px 30px -12px rgba(15,23,42,.25);
  --footer-cols:3;
  --font-body:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  --font-mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,monospace;
}`;

export function buildLandingPage(input: LandingInput): ApexPage {
  return {
    theme: "light",
    brand: { tokensCss: BRAND_TOKENS },
    head: {
      lang: "en",
      title: block(input.blocks, "index:meta.title", "Tasklane — ship your roadmap"),
      description: block(
        input.blocks,
        "index:meta.description",
        "Plan, track and ship product work in one place. Free to start, no credit card.",
      ),
      canonicalUrl: "https://tasklane.example/",
    },
    header: {
      brand: { href: "/", label: "Tasklane" },
      // A dropdown nav entry (kind:"menu") renders an icon/title/desc panel on
      // hover + keyboard focus; plain links sit beside it. One typed shape, no
      // app CSS — the renderer ships the dropdown styling.
      navLinks: [
        {
          kind: "menu",
          label: "Product",
          items: [
            {
              icon: FEATURE_ICON.bolt,
              title: "Live planning",
              desc: "Reorder, estimate and assign as you type.",
              href: "#features",
            },
            {
              icon: FEATURE_ICON.layers,
              title: "Portfolio view",
              desc: "Every project on one screen, at a glance.",
              href: "#features",
            },
            {
              icon: FEATURE_ICON.shield,
              title: "Your data, yours",
              desc: "EU-hosted, no tracking, export any time.",
              href: "#features",
            },
          ],
          footer: { label: "See all features", href: "#features" },
        },
        { label: "Pricing", href: "#pricing" },
      ],
      actions: [{ label: "Sign in", href: "/login", variant: "link" }],
    },
    sections: [
      {
        kind: "hero",
        title: block(input.blocks, "index:hero.title", "Ship your roadmap, not your spreadsheet"),
        tagline: block(
          input.blocks,
          "index:hero.tagline",
          "Plan, track and ship product work in one place — free to start, no credit card.",
        ),
        ctas: [
          { label: "Start free", href: "/signup", variant: "primary" },
          { label: "See pricing", href: "#pricing", variant: "secondary" },
        ],
        metaHtml: "<strong>Free forever plan.</strong> No credit card required.",
      },
      {
        kind: "feature-grid",
        id: "features",
        eyebrow: "Features",
        heading: "Everything your team needs to ship",
        sub: "From a single backlog to the whole portfolio — without tab-juggling.",
        items: [
          {
            icon: FEATURE_ICON.bolt,
            title: "Live planning",
            desc: "Reorder, estimate and assign in one board that updates as you type.",
          },
          {
            icon: FEATURE_ICON.layers,
            title: "Portfolio view",
            desc: "Every project on one screen: progress, owners and ship dates at a glance.",
          },
          {
            icon: FEATURE_ICON.shield,
            title: "Your data, yours",
            desc: "EU-hosted, no tracking, export any time. Privacy is the baseline, not a tier.",
          },
        ],
      },
      {
        kind: "pricing-grid",
        id: "pricing",
        eyebrow: "Pricing",
        heading: "Fair prices, clear limits",
        sub: "Start free. Upgrade when your portfolio grows. Cancel any time.",
        tiers: input.plans.map(toPricingTier),
      },
      {
        kind: "final-cta",
        heading: "Your first board in two minutes",
        sub: "Start free — no credit card, no install.",
        cta: { label: "Start free", href: "/signup", variant: "primary" },
      },
    ],
    footer: {
      brand: { label: "Tasklane" },
      tagline: "Ship your roadmap.",
      columns: [
        {
          heading: "Product",
          links: [
            { label: "Features", href: "#features" },
            { label: "Pricing", href: "#pricing" },
          ],
        },
        {
          heading: "Company",
          links: [
            { label: "About", href: "/about" },
            { label: "Contact", href: "/contact" },
          ],
        },
        {
          heading: "Legal",
          links: [
            { label: "Privacy", href: "/legal/privacy" },
            { label: "Imprint", href: "/legal/imprint" },
          ],
        },
      ],
      bottomLeft: "© 2026 Tasklane",
      bottomRight: "Made with Kumiko",
    },
  };
}

/** Convenience: input → final HTML string an app serves as its landing page. */
export function renderLanding(input: LandingInput): string {
  return renderApexPage(buildLandingPage(input));
}

/** Sample plan config, as a `tier-engine`-backed app would expose it.
 *  Used by the test and the screenshot runner. */
export const SAMPLE_PLANS: readonly PlanInfo[] = [
  {
    key: "free",
    name: "Free",
    tagline: "For your first project",
    monthlyEur: null,
    maxProjects: 3,
    benefits: ["Live planning board", "Up to 5 collaborators", "CSV export"],
  },
  {
    key: "pro",
    name: "Pro",
    tagline: "For a growing team",
    monthlyEur: 12,
    maxProjects: 50,
    benefits: ["Everything in Free", "Portfolio view", "Custom fields", "Priority support"],
    featured: true,
  },
  {
    key: "enterprise",
    name: "Enterprise",
    tagline: "For the whole org",
    monthlyEur: null,
    maxProjects: Number.POSITIVE_INFINITY,
    benefits: ["Everything in Pro", "SSO & SCIM", "Dedicated instance", "SLA"],
  },
];
