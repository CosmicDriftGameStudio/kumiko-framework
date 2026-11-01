import { MAX_PAYLOAD_DEPTH } from "@cosmicdrift/kumiko-framework/api";
import { isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";
import { curlExample } from "./curl.ts";
import { errorMeaningTable } from "./error-table.ts";
import { LIST_INPUT_JSON_SCHEMA, listParameterText } from "./list-parameters.ts";
import { codeSpan, fenced, pageBuilder, type RenderedPage, table } from "./markdown.ts";
import type { ApiDocsHandler } from "./model.ts";
import { typeLabel } from "./schema-fields.ts";
import { overviewSectionIds as ids } from "./section-ids.ts";
import { type ApiDocsTexts, formatApiDocsText } from "./texts/index.ts";

export type OverviewInput = {
  readonly handlers: readonly ApiDocsHandler[];
  readonly texts: ApiDocsTexts;
  readonly baseUrl: string;
};

function listParameterTable(texts: ApiDocsTexts): string {
  const jsonSchema = LIST_INPUT_JSON_SCHEMA;
  const properties = jsonSchema.properties ?? {};
  const [field, type, description] = texts.text["overview.lists.columns"].split(" | ");
  return table(
    [field ?? "", type ?? "", description ?? ""],
    Object.keys(texts.listParameters).map((name) => [
      codeSpan(name),
      typeLabel(propertyNode(properties[name]), jsonSchema),
      listParameterText(texts, name) ?? "",
    ]),
  );
}

/** A read handler is the safest example: pasting it changes nothing. */
export function exampleHandler(handlers: readonly ApiDocsHandler[]): ApiDocsHandler | undefined {
  return handlers.find((handler) => handler.kind === "query") ?? handlers[0];
}

export function renderOverview(input: OverviewInput): RenderedPage {
  const { texts, baseUrl } = input;
  const text = texts.text;
  const example = exampleHandler(input.handlers);
  const page = pageBuilder(text["overview.title"], text["overview.description"]);
  page.add(text["overview.intro"]);
  page.section(ids.endpoints, text["overview.endpoints.heading"]);
  page.add(
    table(
      ["Endpoint", ""],
      [
        [codeSpan("POST /api/query"), text["overview.endpoints.query"]],
        [codeSpan("POST /api/write"), text["overview.endpoints.write"]],
        [codeSpan("POST /api/batch"), text["overview.endpoints.batch"]],
      ],
    ),
  );
  page.section(ids.auth, text["overview.auth.heading"]);
  page.add(text["overview.auth.body"]);
  page.section(ids.body, text["overview.body.heading"]);
  page.add(
    formatApiDocsText(text["overview.body.body"], {
      exampleType: example?.qn ?? "feature:query:entity:list",
      maxDepth: MAX_PAYLOAD_DEPTH,
    }),
    ...(example === undefined ? [] : [fenced("bash", curlExample(example, baseUrl))]),
  );
  page.section(ids.responses, text["overview.responses.heading"]);
  page.add(text["overview.responses.success"], text["overview.responses.error"]);
  page.section(ids.errors, text["overview.errors.heading"]);
  page.add(errorMeaningTable(texts, text["overview.errors.columns"]));
  page.section(ids.versions, text["overview.versions.heading"]);
  page.add(text["overview.versions.body"]);
  page.section(ids.lists, text["overview.lists.heading"]);
  page.add(
    text["overview.lists.intro"],
    listParameterTable(texts),
    text["overview.lists.response"],
  );
  page.section(ids.batch, text["overview.batch.heading"]);
  page.add(text["overview.batch.body"]);
  page.section(ids.retry, text["overview.retry.heading"]);
  page.add(text["overview.retry.body"]);
  return page.finish();
}

// JSON Schema allows a bare boolean as a property schema; the list schema has none.
function propertyNode(property: unknown): Readonly<Record<string, unknown>> {
  return isPlainObject(property) ? property : {};
}
