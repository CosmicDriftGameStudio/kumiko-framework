import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  buildFeatureManifest,
  MANIFEST_PATH,
  serializeManifest,
} from "../../scripts/gen-feature-manifest";

describe("feature-manifest", () => {
  test("committed feature-manifest.json is up to date with the booted registry", () => {
    const fresh = serializeManifest(buildFeatureManifest());
    const committed = readFileSync(MANIFEST_PATH, "utf-8");
    // Stale? Run: bun run scripts/gen-feature-manifest.ts
    expect(committed).toBe(fresh);
  });

  test("introspects scope + per-role access for SMTP config (the drift-prone case)", () => {
    const manifest = buildFeatureManifest();
    const smtp = manifest.features.find((f) => f.name === "mail-transport-smtp");

    expect(smtp).toBeDefined();
    expect(smtp?.requires).toContain("secrets");
    expect(smtp?.extensionsUsed).toContainEqual({
      extensionName: "mailTransport",
      entityName: "smtp",
    });

    const host = smtp?.configKeys.find((k) => k.key === "host");
    expect(host?.type).toBe("text");
    expect(host?.scope).toBe("tenant");
    expect(host?.writeRoles).toContain("TenantAdmin");

    const port = smtp?.configKeys.find((k) => k.key === "port");
    expect(port?.bounds).toEqual({ min: 1, max: 65535 });
  });
});
