import { expect } from "bun:test";
import { Project } from "ts-morph";
import { parseSourceFile } from "../parse.js";
import type { FeaturePattern } from "../patterns.js";

export const STATIC_FEATURE = `
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";

defineFeature("inventory", (r) => {
  r.requires("auth", "tenant");
  r.toggleable({ default: true });

  r.entity("item", {
    fields: {
      name: { type: "text", required: true },
      sku: { type: "text" },
      onHand: { type: "number" },
    },
  });

  r.relation("item", "supplier", { type: "belongsTo", target: "user", foreignKey: "supplierId" });

  r.metric("created", { type: "counter" });
  r.secret("apiKey", { label: { en: "Stripe API Key" }, scope: "tenant" });
  r.claimKey("teamId", { type: "string" });

  r.referenceData(
    "category",
    [
      { id: "a", label: "A" },
      { id: "b", label: "B" },
    ],
    { upsertKey: "id" },
  );

  r.config({
    keys: {
      maxRows: {
        type: "number",
        default: 50,
        scope: "tenant",
        access: { read: ["user"], write: ["admin"] },
      },
    },
  });
});
`;

export const DEFINE_EVENT_WITH_MIGRATIONS_FEATURE = `
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";

defineFeature("billing", (r) => {
  r.defineEvent("invoicePaid", z.object({ totalCents: z.number() }), {
    piiFields: "none",
    version: 2,
    migrations: [
      {
        fromVersion: 1,
        toVersion: 2,
        transform: (payload: unknown) => ({ totalCents: Math.round((payload as { total: number }).total * 100) }),
      },
    ],
  });
});
`;

export function parse(source: string): {
  featureName: string | undefined;
  patterns: readonly FeaturePattern[];
} {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    useInMemoryFileSystem: true,
  });
  const sf = project.createSourceFile(`f-${Math.random()}.ts`, source);
  const result = parseSourceFile(sf);
  expect(result.errors).toEqual([]);
  return { featureName: result.featureName, patterns: result.patterns };
}
