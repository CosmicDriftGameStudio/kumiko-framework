import { describe, expect, test } from "bun:test";
import { eventAnchors } from "../anchors.ts";
import { generateApiDocs } from "../generate.ts";
import { fixtureConfig, fixtureInput } from "./fixtures.ts";

const EVENTS = ["billing:invoice-paid", "ticket.created", "ticket:created"] as const;
const configWithDelivery = {
  ...fixtureConfig,
  webhookDelivery: { en: "Deliveries are signed.", de: "Zustellungen sind signiert." },
};

describe("events page", () => {
  const { files, problems } = generateApiDocs(
    fixtureInput({
      events: EVENTS,
      config: configWithDelivery,
      webhookExamples: [
        {
          fileName: "ticket-created.json",
          file: { event: "ticket:created", version: 2, payload: { id: "id-1", subject: "Hi" } },
        },
      ],
    }),
  );
  const file = (path: string): string => files.get(path) ?? "";

  test("is emitted per locale with the fixed sections and the app delivery text", () => {
    const page = file("en/events.md");
    expect(page).toContain("## Delivery");
    expect(page).toContain("Deliveries are signed.");
    expect(file("de/events.md")).toContain("Zustellungen sind signiert.");
    expect(page).toContain("### ticket.opened");
    expect(page).toContain("### ticket.created");
    expect(page).toContain("### invoice-paid");
    expect(page).not.toContain("### ticket:created");
    expect(page).not.toContain("billing:invoice-paid");
    expect(page).not.toMatch(/<[A-Za-z]/);
  });

  test("declared description is translated, falls back to en, and the example is rendered", () => {
    expect(file("de/events.md")).toContain("Ein Kunde hat ein Ticket eröffnet.");
    expect(file("de/events.md")).toContain("An invoice was paid.");
    expect(file("en/events.md")).toContain('"subject": "Hi"');
  });

  test("declared field text comes from the translation key per locale, else from .describe()", () => {
    expect(file("de/events.md")).toContain("| `subject` | string | ja | Kurze Zusammenfassung |");
    expect(file("en/events.md")).toContain("| `subject` | string | yes | Short summary |");
  });

  test("a missing de description translation is reported for the declared event only", () => {
    expect(problems).toContainEqual({
      kind: "webhookEventWithoutDescriptionTranslation",
      qn: "billing:invoice-paid",
      locale: "de",
    });
    expect(
      problems.filter((p) => p.kind === "webhookEventWithoutDescriptionTranslation"),
    ).toHaveLength(1);
    expect(problems.map((p) => p.kind)).not.toContain("webhookDeliveryTextMissing");
  });

  test("openapi has webhooks keyed by QN with distinct schema names, index.json lists the page", () => {
    const openapi = JSON.parse(file("openapi.json"));
    expect(Object.keys(openapi.webhooks)).toEqual([
      "invoice-paid",
      "ticket.created",
      "ticket.opened",
    ]);
    expect(openapi.webhooks["ticket.opened"].post["x-kumiko-qn"]).toBe("ticket:created");
    const refs = Object.values<{
      post: { requestBody: { content: { "application/json": { schema: { $ref: string } } } } };
    }>(openapi.webhooks).map(
      (hook) => hook.post.requestBody.content["application/json"].schema.$ref,
    );
    expect(new Set(refs).size).toBe(3);
    expect(openapi.webhooks["ticket.opened"].post["x-kumiko-version"]).toBe(2);
    expect(openapi.webhooks["ticket.opened"].post["x-kumiko-scope"]).toEqual(["tickets:read"]);
    const index = JSON.parse(file("index.json"));
    expect(JSON.stringify(index)).toContain("events.md");
  });

  test("output is independent of feature order", () => {
    const reversed = generateApiDocs(
      fixtureInput({ events: EVENTS, config: configWithDelivery, reverse: true }),
    );
    expect(reversed.files.get("en/events.md")).toBe(
      generateApiDocs(fixtureInput({ events: EVENTS, config: configWithDelivery })).files.get(
        "en/events.md",
      ),
    );
  });
});

describe("without public events", () => {
  test("no events page, no webhooks key and no delivery problem", () => {
    const { files, problems } = generateApiDocs(fixtureInput());
    expect(files.has("en/events.md")).toBe(false);
    expect(JSON.parse(files.get("openapi.json") ?? "{}").webhooks).toBeUndefined();
    expect(problems.map((p) => p.kind)).not.toContain("webhookDeliveryTextMissing");
  });
});

describe("delivery text", () => {
  test("a locale without text is reported", () => {
    const { problems } = generateApiDocs(
      fixtureInput({
        events: EVENTS,
        config: { ...fixtureConfig, webhookDelivery: { en: "Signed." } },
      }),
    );
    expect(problems).toContainEqual({ kind: "webhookDeliveryTextMissing", locale: "de" });
  });
});

describe("eventAnchors", () => {
  test("repeated slugs get GitHub style suffixes in QN order", () => {
    const anchors = eventAnchors(["ticket.created", "ticket:created"]);
    expect(anchors.map((a) => a.heading)).toEqual(["ticket.created", "ticket:created"]);
    expect(new Set(anchors.map((a) => a.anchor)).size).toBe(2);
  });
});
