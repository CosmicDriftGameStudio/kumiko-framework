/** Product UI mock in the hero `.shot-frame` — not the full-page docs shot. */
export const HERO_SCREENSHOT = {
  src: "/screenshots/hero-app.png",
  alt: "Tasklane planning board — click to enlarge",
  width: 720,
  height: 480,
} as const;

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
