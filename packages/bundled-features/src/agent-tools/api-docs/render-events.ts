import type { WebhookEntityVerb } from "@cosmicdrift/kumiko-framework/engine";
import { eventAnchors } from "./anchors.ts";
import { codeSpan, fenced, pageBuilder, type RenderedPage, table } from "./markdown.ts";
import type { ApiDocsEvent } from "./model.ts";
import { fieldRows } from "./schema-fields.ts";
import { eventsSectionIds as ids } from "./section-ids.ts";
import { type ApiDocsTextKey, type ApiDocsTexts, formatApiDocsText } from "./texts/index.ts";

export type EventsInput = {
  readonly events: readonly ApiDocsEvent[];
  readonly locale: string;
  readonly texts: ApiDocsTexts;
  /** The app's delivery description; the section stays, empty, when the app wrote none. */
  readonly deliveryText: string | undefined;
};

const entityDescriptionKeys = {
  created: "events.entity.created",
  updated: "events.entity.updated",
  deleted: "events.entity.deleted",
} as const satisfies Record<WebhookEntityVerb, ApiDocsTextKey>;

export function describeEvent(event: ApiDocsEvent, locale: string, texts: ApiDocsTexts): string {
  if (event.origin === "declared" || event.verb === undefined) {
    return event.description[locale] ?? "";
  }
  return formatApiDocsText(texts.text[entityDescriptionKeys[event.verb]], {
    entity: event.entityLabel[locale] ?? event.entity ?? "",
  });
}

function payloadTable(event: ApiDocsEvent, locale: string, texts: ApiDocsTexts): string {
  const rows = fieldRows(event.payloadSchema);
  if (rows.length === 0) return texts.text["events.noFields"];
  const [name, type, required, description] = texts.text["reference.fields.columns"].split(" | ");
  return table(
    [name ?? "", type ?? "", required ?? "", description ?? ""],
    rows.map((row) => [
      codeSpan(row.name),
      row.type,
      row.required ? texts.text["reference.yes"] : texts.text["reference.no"],
      event.fieldLabels[row.name]?.[locale] ?? row.schemaDescription ?? "",
    ]),
  );
}

export function renderEventsPage(input: EventsInput): RenderedPage {
  const { texts } = input;
  const text = texts.text;
  const page = pageBuilder(text["events.title"], text["events.description"]);
  page.add(text["events.intro"]);
  page.section(ids.delivery, text["events.delivery.heading"]);
  if (input.deliveryText !== undefined) page.add(input.deliveryText);
  page.section(ids.versions, text["events.versions.heading"]);
  page.add(text["events.versions.body"]);
  page.section(ids.list, text["events.list.heading"]);
  const anchors = eventAnchors(input.events.map((event) => event.wireName));
  input.events.forEach((event, index) => {
    const anchor = anchors[index];
    // skip: eventAnchors returns one entry per event, so a gap only means an empty list
    if (anchor === undefined) return;
    page.section(anchor.anchor, anchor.heading, 3, event.qn);
    page.add(
      describeEvent(event, input.locale, texts),
      `- ${text["events.version"]}: ${codeSpan(String(event.version))}\n- ${text["events.requiredScope"]}: ${event.domains.map((domain) => codeSpan(`${domain}:read`)).join(", ")}`,
      payloadTable(event, input.locale, texts),
    );
    if (event.example !== undefined) {
      page.add(
        `**${text["events.example"]}**`,
        fenced("json", JSON.stringify(event.example.payload, null, 2)),
      );
    }
  });
  return page.finish();
}
