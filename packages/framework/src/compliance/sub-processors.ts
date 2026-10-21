// Kumiko platform sub-processors.
//
// Processors within the meaning of GDPR Article 28 that Kumiko uses for
// platform operations. Publicly exposed at:
//   /api/compliance/sub-processors        (JSON)
//   /api/compliance/sub-processors.rss    (RSS)
//
// Separate from the public marketing overview (kumiko.rocks/subprocessors),
// which is compiled independently from templates/legal/_shared/subprocessors/
// catalog.*.md. The two lists are not synced.
//
// Tenant admins must be informed of additions, changes, and removals with
// the lead time from the compliance profile (typically 30d). The notification
// cron is not available yet.
//
// SubProcessor has no "removed" state yet: a removed entry is deleted from
// the array, so until the notification cron exists a removal is documented
// only in the changelog. Removed so far: Mailbox.org (mailbox hosting),
// replaced by ALL-INKL.COM.

/**
 * Bundle tier marker for SubProcessor.appliesTo. "all-tiers" matches
 * regardless of the tenant's specific bundle (for example, Hetzner as a
 * hosting provider). Specific tier names can be filtered per tenant.
 */
export type BundleTier = "all-tiers" | "standard" | "business" | "enterprise";

/**
 * Describes a processor within the meaning of GDPR Article 28 that Kumiko
 * uses for platform operations.
 */
export interface SubProcessor {
  /** Voller juristischer Name. */
  readonly name: string;
  /** What the sub-processor does for us. */
  readonly purpose: string;
  /** Sitz / Datenverarbeitungs-Region. */
  readonly region: string;
  /** Link to the data processing agreement (DPA/AVV). */
  readonly dpa: string;
  /** Date when the sub-processor was added to the platform. */
  readonly addedAt: string;
  /**
   * Bundle tiers that use this sub-processor.
   * Tenants in unaffected tiers do not need notifications about changes.
   */
  readonly appliesTo: readonly BundleTier[];
  /**
   * Whether Standard Contractual Clauses (SCC) for transfers to third
   * countries have been concluded. Required for all sub-processors based
   * outside the EU/EEA.
   */
  readonly sccRequired?: boolean;
  /**
   * The tenant must explicitly activate this sub-processor (for example,
   * for an AI feature). No data is sent to it without opt-in.
   */
  readonly optInOnly?: boolean;
  /**
   * Whether a Business Associate Agreement is available for HIPAA customers.
   * Relevant only for hipaa-healthcare compliance profiles.
   */
  readonly hipaaBaaAvailable?: boolean;
  /**
   * Planned but not yet active.
   * The sub-processor endpoint outputs it in a separate "planned" section
   * so tenants receive lead time for configuration.
   */
  readonly status?: "active" | "planned";
}

/**
 * Platform-wide sub-processor list.
 *
 * Ordered by addedAt (oldest first). Update the snapshot test explicitly
 * when changing this list; it detects silent changes.
 */
export const KUMIKO_SUB_PROCESSORS: readonly SubProcessor[] = [
  {
    name: "Hetzner Online GmbH",
    purpose: "Cloud-Infrastructure (CNPG-Postgres-Cluster, K8s-Pods, Volumes, Object-Storage)",
    region: "EU (Germany)",
    dpa: "https://www.hetzner.com/legal/dpa",
    addedAt: "2024-01-01",
    appliesTo: ["all-tiers"],
    status: "active",
  },
  {
    name: "Cloudflare, Inc.",
    purpose: "DNS, CDN, DDoS-Protection, WAF",
    region: "Global (US-headquartered)",
    dpa: "https://www.cloudflare.com/cloudflare-customer-dpa",
    addedAt: "2024-01-01",
    appliesTo: ["all-tiers"],
    sccRequired: true,
    status: "active",
  },
  {
    name: "Sendinblue SAS (Brevo)",
    purpose: "Transactional Email Delivery",
    region: "EU (France)",
    dpa: "https://www.brevo.com/legal/dpa/",
    addedAt: "2024-03-01",
    appliesTo: ["standard", "business", "enterprise"],
    status: "active",
  },
  {
    name: "Anthropic PBC",
    purpose: "AI Model Inference (L2 Composition Layer, AI-Foundation)",
    region: "US",
    dpa: "https://www.anthropic.com/legal/dpa",
    addedAt: "2026-06-01",
    appliesTo: ["business", "enterprise"],
    sccRequired: true,
    optInOnly: true,
    hipaaBaaAvailable: true,
    status: "active",
  },
  {
    name: "Stripe, Inc.",
    purpose: "Payment Processing (Subscription-Stripe-Plugin)",
    region: "Global (US-headquartered)",
    dpa: "https://stripe.com/legal/dpa",
    addedAt: "2026-06-01",
    appliesTo: ["all-tiers"],
    sccRequired: true,
    status: "active",
  },
  {
    name: "ALL-INKL.COM – Neue Medien Münnich",
    purpose: "Mailbox Hosting (support and contact mailboxes)",
    region: "EU (Germany)",
    dpa: "https://all-inkl.com/members/avv_muster_print.php",
    addedAt: "2026-09-02",
    appliesTo: ["all-tiers"],
    status: "active",
  },
  {
    name: "Scaleway SAS",
    purpose: "Offsite Backup Mirror (Object Storage)",
    region: "EU (France)",
    dpa: "https://www.scaleway.com/en/contracts/",
    addedAt: "2026-09-18",
    appliesTo: ["all-tiers"],
    status: "active",
  },
  {
    name: "Scaleway SAS",
    purpose: "Platform key custody (Key Manager) and Transactional Email Delivery",
    region: "EU (France)",
    dpa: "https://www.scaleway.com/en/contracts/",
    addedAt: "2026-09-18",
    appliesTo: ["all-tiers"],
    status: "planned",
  },
];

/**
 * Filter helper — active sub-processors only (excluding status="planned").
 * Used by the public JSON endpoint.
 */
export function getActiveSubProcessors(): readonly SubProcessor[] {
  return KUMIKO_SUB_PROCESSORS.filter((sp) => sp.status !== "planned");
}

/**
 * Filter helper — planned sub-processors only (status="planned"). They are
 * output separately in a "coming soon" section so tenant admins receive
 * lead time for compliance profile configuration.
 */
export function getPlannedSubProcessors(): readonly SubProcessor[] {
  return KUMIKO_SUB_PROCESSORS.filter((sp) => sp.status === "planned");
}
