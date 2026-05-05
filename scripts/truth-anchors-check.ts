/**
 * Truth-Anchors Frontmatter-Validator.
 *
 * Scannt MD/MDX-Files in Doku- und Marketing-Folders und validiert das
 * `truth_anchors:`-Frontmatter gegen die Contract-Layer (concepts/*.yaml).
 *
 * Frontmatter-Schema:
 *
 *   ---
 *   title: "Designer Edit Guide"
 *   truth_anchors:
 *     capabilities: [designer-edit, audit-trail-git]   # FK auf capabilities.yaml
 *     tiers: [pro, pro-ai]                              # FK auf tiers.yaml
 *     promises: [git-is-audit-trail]                   # FK auf promises.yaml
 *     last_verified: "2026-05-05"                      # ISO-Datum letzter Re-Check
 *     drift_check: strict                              # strict | warn | off
 *   ---
 *
 * Geprüft wird:
 *   1. Schema (zod) — alle Felder typisiert
 *   2. FK-Integrität: alle IDs existieren in concepts/
 *   3. Drift: bei drift_check=strict müssen referenzierte Promises
 *      status != "pending" haben (sonst zitiert Marketing ein nicht-aktives Versprechen)
 *   4. Stale-Marker: last_verified > 90 Tage alt → warning
 *
 * Das Schema wird auch von Astro Content-Collections (kumiko-platform/apps/docs
 * + kumiko-platform/apps/marketing) konsumiert — siehe export am Ende.
 *
 * Siehe docs/plans/cross-domain-strategy.md.
 *
 * Usage:
 *   bun run scripts/truth-anchors-check.ts                    # default: docs/, samples/, README.md
 *   bun run scripts/truth-anchors-check.ts <path> [<path>...] # custom paths
 */

import { existsSync, readFileSync, statSync, readdirSync } from "node:fs";
import { resolve, relative, join, extname } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

const ROOT = resolve(import.meta.dir, "..");

// ---------- Frontmatter-Schema (exportiert für Astro) ---------------------

export const TruthAnchorsSchema = z.object({
  capabilities: z.array(z.string()).optional(),
  tiers: z.array(z.string()).optional(),
  promises: z.array(z.string()).optional(),
  personas: z.array(z.string()).optional(),
  pricing: z.array(z.string()).optional(),
  last_verified: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be ISO YYYY-MM-DD"),
  drift_check: z.enum(["strict", "warn", "off"]).default("warn"),
});

export type TruthAnchors = z.infer<typeof TruthAnchorsSchema>;

const FrontmatterEnvelope = z
  .object({
    truth_anchors: TruthAnchorsSchema.optional(),
  })
  .passthrough();

// ---------- Concept-Loader -------------------------------------------------

function loadYaml<T>(rel: string): T {
  return parseYaml(readFileSync(resolve(ROOT, rel), "utf8")) as T;
}

interface CapabilityRow {
  id: string;
  status: "planned" | "in-progress" | "shipped" | "deprecated";
}
interface PromiseRow {
  id: string;
  status?: "active" | "pending" | "deprecated";
}

const capabilities = loadYaml<CapabilityRow[]>("concepts/capabilities.yaml");
const tiers = loadYaml<{ id: string }[]>("concepts/tiers.yaml");
const promises = loadYaml<PromiseRow[]>("concepts/promises.yaml");
const personas = loadYaml<{ id: string }[]>("concepts/personas.yaml");
const pricingRows = loadYaml<{ id: string }[]>("concepts/pricing.yaml");

const capIds = new Set(capabilities.map((c) => c.id));
const tierIds = new Set(tiers.map((t) => t.id));
const promiseById = new Map(promises.map((p) => [p.id, p]));
const personaIds = new Set(personas.map((p) => p.id));
const pricingIds = new Set(pricingRows.map((p) => p.id));

// ---------- File-Scan ------------------------------------------------------

const args = process.argv.slice(2);
const scanRoots = args.length > 0 ? args : ["docs", "samples", "README.md"];

function walk(path: string, out: string[]): void {
  if (!existsSync(path)) return;
  const stat = statSync(path);
  if (stat.isFile()) {
    const ext = extname(path);
    if (ext === ".md" || ext === ".mdx") out.push(path);
    return;
  }
  for (const entry of readdirSync(path)) {
    if (entry.startsWith(".") || entry === "node_modules" || entry === "_archive") continue;
    walk(join(path, entry), out);
  }
}

const files: string[] = [];
for (const r of scanRoots) walk(resolve(ROOT, r), files);

// ---------- Frontmatter-Parser --------------------------------------------

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;

function extractFrontmatter(text: string): unknown | null {
  const match = FRONTMATTER_RE.exec(text);
  if (!match) return null;
  try {
    return parseYaml(match[1]!);
  } catch {
    return null;
  }
}

// ---------- Validation -----------------------------------------------------

const errors: string[] = [];
const warnings: string[] = [];
let validatedCount = 0;

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
const now = Date.now();

for (const file of files) {
  const text = readFileSync(file, "utf8");
  const fm = extractFrontmatter(text);
  if (!fm || typeof fm !== "object") continue;

  const envelope = FrontmatterEnvelope.safeParse(fm);
  if (!envelope.success) continue; // file has frontmatter but no truth_anchors block — skip
  const anchors = envelope.data.truth_anchors;
  if (!anchors) continue;

  validatedCount++;
  const rel = relative(ROOT, file);
  const where = `truth_anchors/${rel}`;
  const drift = anchors.drift_check;

  // FK checks
  for (const id of anchors.capabilities ?? []) {
    if (!capIds.has(id)) errors.push(`  ✗ [${where}] unknown capability: "${id}"`);
  }
  for (const id of anchors.tiers ?? []) {
    if (!tierIds.has(id)) errors.push(`  ✗ [${where}] unknown tier: "${id}"`);
  }
  for (const id of anchors.promises ?? []) {
    const p = promiseById.get(id);
    if (!p) {
      errors.push(`  ✗ [${where}] unknown promise: "${id}"`);
      continue;
    }
    if (p.status === "pending") {
      const msg = `cites promise "${id}" which is status: pending — capability not shipped yet`;
      if (drift === "strict") errors.push(`  ✗ [${where}] ${msg}`);
      else if (drift === "warn") warnings.push(`  ! [${where}] ${msg}`);
    } else if (p.status === "deprecated") {
      errors.push(`  ✗ [${where}] cites deprecated promise: "${id}"`);
    }
  }
  for (const id of anchors.personas ?? []) {
    if (!personaIds.has(id)) errors.push(`  ✗ [${where}] unknown persona: "${id}"`);
  }
  for (const id of anchors.pricing ?? []) {
    if (!pricingIds.has(id)) errors.push(`  ✗ [${where}] unknown pricing row: "${id}"`);
  }

  // Stale-Marker
  const verified = Date.parse(anchors.last_verified);
  if (!Number.isNaN(verified)) {
    const ageMs = now - verified;
    if (ageMs > NINETY_DAYS_MS) {
      const days = Math.floor(ageMs / (24 * 60 * 60 * 1000));
      warnings.push(`  ! [${where}] last_verified is ${days} days old — please re-confirm`);
    }
  }
}

// ---------- Output ---------------------------------------------------------

if (warnings.length > 0) {
  console.log("\nTruth-Anchors Warnings:");
  for (const w of warnings) console.log(w);
}
if (errors.length > 0) {
  console.log("\nTruth-Anchors Errors:");
  for (const e of errors) console.log(e);
  console.log(`\n  ${errors.length} error(s), ${warnings.length} warning(s) across ${validatedCount} truth-anchored file(s).`);
  process.exit(1);
} else {
  console.log(`\n  truth-anchors OK — ${validatedCount} truth-anchored file(s) scanned (${warnings.length} warning(s)).`);
}
