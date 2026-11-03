import { describe, expect, test } from "bun:test";
import { createRegistry, defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { createPersonalAccessTokensFeature } from "../../../personal-access-tokens/index.ts";
import { generateApiDocs } from "../generate.ts";
import { buildFixtureFeatures, fixtureConfig, fixtureInput } from "./fixtures.ts";

const OPEN_ACCESS = { openToAll: { reason: "fixture handler callable by any signed-in user" } };
const WITHOUT_PAT = (feature: { name: string }) => feature.name !== "personal-access-tokens";

function patWith(scopes: Parameters<typeof createPersonalAccessTokensFeature>[0]["scopes"]) {
  return createPersonalAccessTokensFeature({ scopes });
}

describe("self-referencing input schema", () => {
  const nodeSchema: z.ZodType = z.object({
    name: z.string(),
    get child() {
      return nodeSchema.optional();
    },
  });
  const recursive = defineFeature("recursive", (r) => {
    r.queryHandler({
      name: "node:tree",
      schema: nodeSchema,
      handler: async () => ({}),
      access: OPEN_ACCESS,
      description: "Reads a tree.",
    });
  });

  test("a root ref points at the payload schema, not at the OpenAPI document", () => {
    const { files } = generateApiDocs({
      ...fixtureInput(),
      registry: createRegistry([
        ...buildFixtureFeatures().filter(WITHOUT_PAT),
        recursive,
        patWith({ tree: { label: "Tree", read: ["recursive:query:*"] } }),
      ]),
    });
    const openapi = files.get("openapi.json") ?? "";
    expect(openapi).not.toContain('"$ref": "#"');
    expect(openapi).toContain('"$ref": "#/components/schemas/recursive.query.node.tree.payload"');
  });
});

describe("PAT feature detection", () => {
  test("a feature with a look-alike scopes export in front of the token feature is ignored", () => {
    const decoy = defineFeature("decoy", () => ({
      scopes: { decoy: { label: "Decoy", read: ["decoy:query:*"] } },
    }));
    const features = buildFixtureFeatures().filter(WITHOUT_PAT);
    const pat = buildFixtureFeatures().filter((f) => !WITHOUT_PAT(f));
    const { files } = generateApiDocs({
      ...fixtureInput(),
      registry: createRegistry([decoy, ...features, ...pat]),
    });
    expect([...files.keys()]).toContain("en/reference/tickets.md");
    expect([...files.keys()]).not.toContain("en/reference/decoy.md");
  });
});

describe("reference page slugs", () => {
  test("two scope domains with the same slug are reported", () => {
    const { problems } = generateApiDocs({
      ...fixtureInput(),
      registry: createRegistry([
        ...buildFixtureFeatures().filter(WITHOUT_PAT),
        patWith({
          "tickets.v2": { label: "A", read: ["ticketing:query:*"] },
          ticketsv2: { label: "B", read: ["ticketing:query:*"] },
        }),
      ]),
    });
    expect(problems).toContainEqual({
      kind: "scopeSlugCollision",
      slug: "ticketsv2",
      domains: ["tickets.v2", "ticketsv2"],
    });
  });
});

describe("recorded webhook examples", () => {
  const config = { ...fixtureConfig, webhookDelivery: { en: "Signed.", de: "Signiert." } };
  const generate = (
    webhookExamples: {
      fileName: string;
      file: { event: string; version: number; payload: Record<string, unknown> };
    }[],
  ) => generateApiDocs(fixtureInput({ events: ["ticket:created"], config, webhookExamples }));

  test("an example recorded for an older contract version is not shown and is reported", () => {
    const { files, problems } = generate([
      {
        fileName: "old.json",
        file: { event: "ticket:created", version: 1, payload: { subject: "OLD" } },
      },
    ]);
    expect(files.get("en/events.md")).not.toContain("OLD");
    expect(problems).toContainEqual({
      kind: "webhookExampleVersionMismatch",
      qn: "ticket:created",
      fileVersion: 1,
      contractVersion: 2,
    });
  });

  test("an example for an event no scope lists is reported", () => {
    const { problems } = generate([
      { fileName: "other.json", file: { event: "billing:invoice-paid", version: 1, payload: {} } },
    ]);
    expect(problems).toContainEqual({ kind: "unusedWebhookExample", fileName: "other.json" });
  });

  test("a matching example is shown without a problem", () => {
    const { files, problems } = generate([
      {
        fileName: "ok.json",
        file: { event: "ticket:created", version: 2, payload: { subject: "NEW" } },
      },
    ]);
    expect(files.get("en/events.md")).toContain("NEW");
    expect(problems.map((p) => p.kind)).not.toContain("webhookExampleVersionMismatch");
    expect(problems.map((p) => p.kind)).not.toContain("unusedWebhookExample");
  });
});
