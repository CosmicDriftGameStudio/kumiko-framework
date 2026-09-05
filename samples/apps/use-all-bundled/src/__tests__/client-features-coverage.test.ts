// fw-i18n-funde Fund 2: compliance-profiles is mounted server-side
// (run-config.ts) and ships a /web client-plugin (registers
// ComplianceProfileCatalog as an extensionSectionComponent), but client.tsx
// never called complianceProfilesClient() — the profile-picker screen threw
// "component not registered" instead of rendering. This is a coverage gate
// for the class of bug, not just that one instance: for every bundled
// feature this app mounts server-side that ALSO exports a `*Client()`
// factory from its `/web` subpath, the same factory must actually be
// called somewhere in client.tsx. A feature can be deliberately exempted
// (see EXEMPT below) — but only with a reason, so the next gap is a
// decision, not an oversight.
//
// "Deliberately exempted" today means: the feature is mounted for
// server-side/GDPR coverage only and its /web plugin's UI surface (a
// custom screen, a nav-provider tree, an extension section) is never
// wired to anything this app actually navigates to — the runtime error
// class this test guards against can't occur because nothing ever tries
// to render the component.

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { APP_FEATURES } from "../run-config";

const HERE = dirname(fileURLToPath(import.meta.url));
const BUNDLED_FEATURES_SRC = join(HERE, "../../../../../packages/bundled-features/src");
const CLIENT_TSX_PATH = join(HERE, "../app/client.tsx");

// legal-pages: legalPagesClient() only wires a nav-provider tree when the
// app passes a `navId` — use-all-bundled never registers that provider
// node, so calling it would be a no-op; its /legal/* routes are server-
// rendered, not React screens.
// managed-pages: page-list/page-edit/branding-settings are schema-driven
// (entityList/entityEdit/configEdit) with no custom component — the app
// already declares their field/action labels directly in APP_TRANSLATIONS
// (see client.tsx's top comment), same as tenant/user.
// notes-history: NOTES_SECTION_EXTENSION_NAME is never referenced by any
// entity screen this app registers (the dev-only "notes-demo" host wires
// tags/custom-fields/folders, not notes-history) — its component is never
// asked to render.
const EXEMPT: ReadonlySet<string> = new Set(["legal-pages", "managed-pages", "notes-history"]);

async function featuresWithClientFactory(): Promise<ReadonlyMap<string, readonly string[]>> {
  const out = new Map<string, readonly string[]>();
  for (const dirName of readdirSync(BUNDLED_FEATURES_SRC)) {
    if (!statSync(join(BUNDLED_FEATURES_SRC, dirName)).isDirectory()) continue;
    const webIndex = join(BUNDLED_FEATURES_SRC, dirName, "web", "index.ts");
    if (!statSync(webIndex, { throwIfNoEntry: false })?.isFile()) continue;
    const mod: Record<string, unknown> = await import(webIndex);
    const clientFnNames = Object.entries(mod)
      .filter(([key, value]) => key.endsWith("Client") && typeof value === "function")
      .map(([key]) => key);
    if (clientFnNames.length > 0) out.set(dirName, clientFnNames);
  }
  return out;
}

describe("use-all-bundled — client.tsx covers every server-mounted feature's /web plugin", () => {
  test("every mounted feature with a *Client() factory is called in client.tsx, or is EXEMPT with a reason", async () => {
    const mountedNames = new Set(APP_FEATURES.map((f) => f.name));
    const withClientFactory = await featuresWithClientFactory();
    const clientSource = readFileSync(CLIENT_TSX_PATH, "utf-8");

    const missing: string[] = [];
    for (const [featureName, clientFnNames] of withClientFactory) {
      if (!mountedNames.has(featureName)) continue; // not mounted by this app — nothing to gate
      if (EXEMPT.has(featureName)) continue;
      const wired = clientFnNames.some((fn) => clientSource.includes(`${fn}(`));
      if (!wired) missing.push(`${featureName} (expected one of: ${clientFnNames.join(", ")})`);
    }

    expect(missing).toEqual([]);
  });

  test("EXEMPT only lists features this app actually mounts (no stale entries)", () => {
    const mountedNames = new Set(APP_FEATURES.map((f) => f.name));
    const stale = [...EXEMPT].filter((name) => !mountedNames.has(name));
    expect(stale).toEqual([]);
  });
});
