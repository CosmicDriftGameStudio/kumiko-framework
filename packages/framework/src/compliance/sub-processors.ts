// Sub-Processor-Liste der Kumiko-Plattform.
//
// Auftragsverarbeiter im Sinne von DSGVO Art. 28 die Kumiko fuer den
// Plattform-Betrieb einsetzt. Wird oeffentlich exposed unter
//   /api/compliance/sub-processors        (JSON, Sprint 1)
//   /api/compliance/sub-processors.rss    (RSS, Sprint 1)
//   kumiko.so/subprocessors               (HTML, Marketing-Repo)
//
// Tenant-Admins muessen ueber Add/Change/Remove informiert werden mit
// Lead-Time aus dem Compliance-Profile (typisch 30d). Cron-Job kommt
// in Sprint 1 (compliance-profiles).
//
// Quelle: docs/plans/datenschutz/compliance-profiles.md "Sub-Processor-
// Management" + docs/plans/datenschutz/legal-artifacts.md.

/**
 * Beschreibt einen Auftragsverarbeiter (Art. 28 DSGVO) der von Kumiko
 * fuer den Plattform-Betrieb eingesetzt wird.
 */
export interface SubProcessor {
  /** Voller juristischer Name. */
  readonly name: string;
  /** Was macht der Sub-Processor fuer uns? */
  readonly purpose: string;
  /** Sitz / Datenverarbeitungs-Region. */
  readonly region: string;
  /** Link zum Auftragsverarbeitungsvertrag (DPA/AVV). */
  readonly dpa: string;
  /** Wann wurde der Sub-Processor zu unserer Plattform hinzugefuegt? */
  readonly addedAt: string;
  /**
   * Welche Bundle-Tiers nutzen diesen Sub-Processor?
   *   - "all-tiers" | "standard" | "business" | "enterprise"
   * Tenants nicht-betroffener Tiers brauchen keine Notification bei
   * Aenderungen.
   */
  readonly appliesTo: readonly string[];
  /**
   * Standard Contractual Clauses (SCC) fuer Drittlandsuebermittlung
   * abgeschlossen. Pflicht fuer alle Sub-Processors mit Sitz ausserhalb
   * EU/EWR.
   */
  readonly sccRequired?: boolean;
  /**
   * Tenant muss explizit aktivieren (z.B. AI-Feature). Ohne Opt-In
   * werden keine Daten an diesen Sub-Processor gesendet.
   */
  readonly optInOnly?: boolean;
  /**
   * Business Associate Agreement fuer HIPAA-Customers verfuegbar.
   * Relevant nur fuer hipaa-healthcare Compliance-Profile.
   */
  readonly hipaaBaaAvailable?: boolean;
  /**
   * Geplant aber noch nicht aktiv (Vorbereitung fuer kommenden Sprint).
   * Wird im Sub-Processor-Endpoint als "planned"-Sektion separat
   * ausgegeben damit Tenants schon Lead-Time bekommen.
   */
  readonly status?: "active" | "planned";
}

/**
 * Plattform-weite Sub-Processor-Liste.
 *
 * Reihenfolge: nach addedAt (aelteste zuerst). Bei Aenderungen
 * Snapshot-Test im Test-File explizit updaten — der detektiert
 * stille Aenderungen.
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
    name: "Heinlein Hosting (Mailbox.org)",
    purpose: "Marketing Email Delivery",
    region: "EU (Germany)",
    dpa: "https://mailbox.org/de/datenschutzerklaerung",
    addedAt: "2024-03-01",
    appliesTo: ["all-tiers"],
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
    status: "planned",
  },
  {
    name: "Stripe, Inc.",
    purpose: "Payment Processing (Subscription-Stripe-Plugin)",
    region: "Global (US-headquartered)",
    dpa: "https://stripe.com/legal/dpa",
    addedAt: "2026-06-01",
    appliesTo: ["all-tiers"],
    sccRequired: true,
    status: "planned",
  },
];

/**
 * Filter helper — nur aktive Sub-Processors (kein status="planned").
 * Genutzt vom oeffentlichen JSON-Endpoint (Sprint 1).
 */
export function getActiveSubProcessors(): readonly SubProcessor[] {
  return KUMIKO_SUB_PROCESSORS.filter((sp) => sp.status !== "planned");
}

/**
 * Filter helper — nur geplante Sub-Processors (status="planned"). Werden
 * separat als "demnaechst aktiv"-Sektion ausgegeben damit Tenant-Admins
 * schon Lead-Time fuer Compliance-Profile-Konfiguration bekommen.
 */
export function getPlannedSubProcessors(): readonly SubProcessor[] {
  return KUMIKO_SUB_PROCESSORS.filter((sp) => sp.status === "planned");
}
