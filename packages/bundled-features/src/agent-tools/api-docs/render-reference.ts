import type { HandlerAnchor } from "./anchors.ts";
import { curlExample, endpointOf } from "./curl.ts";
import { listParameterText, takesEntityListInput } from "./list-parameters.ts";
import { codeSpan, fenced, pageBuilder, type RenderedPage, table } from "./markdown.ts";
import type { ApiDocsHandler, ApiDocsScope } from "./model.ts";
import { fieldRows } from "./schema-fields.ts";
import { type ApiDocsTexts, formatApiDocsText } from "./texts/index.ts";

export type ReferenceInput = {
  readonly scope: ApiDocsScope;
  readonly handlers: ReadonlyMap<string, ApiDocsHandler>;
  /** One per `scope.handlers` entry, same order. */
  readonly anchors: readonly HandlerAnchor[];
  readonly locale: string;
  readonly texts: ApiDocsTexts;
  readonly baseUrl: string;
};

function fieldTable(handler: ApiDocsHandler, locale: string, texts: ApiDocsTexts): string {
  const rows = fieldRows(handler.inputSchema);
  if (rows.length === 0) return texts.text["reference.noFields"];
  const listInput = takesEntityListInput(handler);
  const [name, type, required, description] = texts.text["reference.fields.columns"].split(" | ");
  return table(
    [name ?? "", type ?? "", required ?? "", description ?? ""],
    rows.map((row) => [
      codeSpan(row.name),
      row.type,
      row.required ? texts.text["reference.yes"] : texts.text["reference.no"],
      handler.fieldLabels[row.name]?.[locale] ??
        row.schemaDescription ??
        (listInput ? listParameterText(texts, row.name) : undefined) ??
        "",
    ]),
  );
}

export function renderReferencePage(input: ReferenceInput): RenderedPage {
  const { scope, texts, locale } = input;
  const text = texts.text;
  const page = pageBuilder(
    scope.label,
    formatApiDocsText(text["reference.description"], { scopeLabel: scope.label }),
  );
  scope.handlers.forEach((entry, index) => {
    const handler = input.handlers.get(entry.qn);
    const anchor = input.anchors[index];
    // skip: scope entries without a collected handler or anchor have nothing to render
    if (handler === undefined || anchor === undefined) return;
    page.section(anchor.anchor, anchor.heading, 3, handler.qn);
    page.add(`**${handler.title[locale] ?? handler.qn}**`);
    const description = handler.description[locale];
    if (description !== undefined) page.add(description);
    page.add(
      `- ${text["reference.requiredScope"]}: ${codeSpan(`${scope.domain}:${entry.grant}`)}\n- ${text["reference.endpoint"]}: ${codeSpan(`POST ${endpointOf(handler)}`)}`,
      fieldTable(handler, locale, texts),
    );
    if (handler.excludedFields.length > 0) {
      page.add(
        formatApiDocsText(text["reference.excluded"], {
          fields: handler.excludedFields.map(codeSpan).join(", "),
        }),
      );
    }
    page.add(
      `**${text["reference.exampleRequest"]}**`,
      fenced("bash", curlExample(handler, input.baseUrl)),
    );
    const response = handler.example?.response;
    if (response !== undefined) {
      page.add(
        `**${text["reference.exampleResponse"]}**`,
        formatApiDocsText(text["reference.status"], { status: response.status }),
        fenced("json", JSON.stringify(response.body, null, 2)),
      );
    }
  });
  return page.finish();
}
