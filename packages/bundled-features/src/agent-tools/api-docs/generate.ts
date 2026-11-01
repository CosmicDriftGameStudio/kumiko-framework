import { findApiDocHandlerGaps, findDescriptionTranslationGaps } from "../agent-doc-lint.ts";
import type { RegistryManifestView } from "../types.ts";
import { anchorsForPage, slugify } from "./anchors.ts";
import { collectApiDocsModel } from "./collect.ts";
import { examplesByHandler, type NamedApiExample } from "./examples.ts";
import { type ApiDocsPageEntry, INDEX_FILE, renderIndexJson } from "./index-json.ts";
import type { RenderedPage } from "./markdown.ts";
import type { ApiDocsSource, ResolvedApiDocsConfig } from "./model.ts";
import { type ApiDocsProblem, sortApiDocsProblems } from "./problems.ts";
import { renderOpenApi } from "./render-openapi.ts";
import { renderOverview } from "./render-overview.ts";
import { renderReferencePage } from "./render-reference.ts";
import { renderTokens } from "./render-tokens.ts";
import { isApiDocsLocale, resolveApiDocsTexts } from "./texts/index.ts";
import { uiWriteProblems } from "./ui-writes.ts";

export const OPENAPI_FILE = "openapi.json";

const OVERVIEW_ORDER = 1;
const TOKENS_ORDER = 2;
const REFERENCE_ORDER_START = 10;

export type ApiDocsInput = {
  readonly registry: RegistryManifestView;
  readonly config: ResolvedApiDocsConfig;
  readonly source: ApiDocsSource;
  readonly examples: readonly NamedApiExample[];
};

export type ApiDocsResult = {
  readonly files: ReadonlyMap<string, string>;
  readonly problems: readonly ApiDocsProblem[];
};

/** Pure: registry in, files and problems out. No I/O, clock or environment, so the
 *  same input always yields byte-identical files. */
export function generateApiDocs(input: ApiDocsInput): ApiDocsResult {
  const { registry, config } = input;
  const { locales } = config;
  if (locales.length === 0) throw new Error("apiDocs needs at least one locale.");
  const unsupported = locales.filter((locale) => !isApiDocsLocale(locale));
  if (unsupported.length > 0) {
    throw new Error(`Unsupported apiDocs locales: ${unsupported.join(", ")}.`);
  }

  const collected = collectApiDocsModel(registry, {
    locales,
    examples: examplesByHandler(input.examples),
  });
  if (collected === undefined) {
    return { files: new Map(), problems: [{ kind: "patFeatureMissing" }] };
  }
  const { model } = collected;
  const problems: ApiDocsProblem[] = [];
  const files = new Map<string, string>();
  const pages: ApiDocsPageEntry[] = [];
  const handlersByQn = new Map(model.handlers.map((handler) => [handler.qn, handler]));

  const addPage = (
    path: string,
    locale: string,
    kind: ApiDocsPageEntry["kind"],
    order: number,
    page: RenderedPage,
    scope?: string,
  ): void => {
    files.set(path, page.content);
    pages.push({
      path,
      locale,
      kind,
      order,
      title: page.title,
      description: page.description,
      ...(scope !== undefined && { scope }),
      anchors: page.anchors,
    });
  };

  for (const locale of locales) {
    if (!isApiDocsLocale(locale)) continue;
    const resolved = resolveApiDocsTexts(locale, config.texts?.[locale]);
    problems.push(...resolved.problems);
    const { texts } = resolved;
    addPage(
      `${locale}/overview.md`,
      locale,
      "overview",
      OVERVIEW_ORDER,
      renderOverview({ handlers: model.handlers, texts, baseUrl: config.baseUrl }),
    );
    addPage(
      `${locale}/tokens.md`,
      locale,
      "tokens",
      TOKENS_ORDER,
      renderTokens({
        model,
        locale,
        texts,
        baseUrl: config.baseUrl,
        appName: config.appName,
        planNote: config.planNote?.[locale],
      }),
    );
    model.scopes.forEach((scope, index) => {
      addPage(
        `${locale}/reference/${slugify(scope.domain)}.md`,
        locale,
        "reference",
        REFERENCE_ORDER_START + index,
        renderReferencePage({
          scope,
          handlers: handlersByQn,
          anchors: anchorsForPage(scope.handlers.map((entry) => entry.qn)),
          locale,
          texts,
          baseUrl: config.baseUrl,
        }),
        scope.domain,
      );
    });
  }

  files.set(
    OPENAPI_FILE,
    renderOpenApi({
      model,
      source: input.source,
      baseUrl: config.baseUrl,
      appName: config.appName,
      descriptionLocale: locales.includes("en") ? "en" : (locales[0] ?? "en"),
    }),
  );
  files.set(INDEX_FILE, renderIndexJson(input.source, locales, pages));

  const handlerQns = model.handlers.map((handler) => handler.qn);
  problems.push(
    ...findApiDocHandlerGaps([...registry.features.values()], new Set(handlerQns)).map(
      (gap): ApiDocsProblem => ({ kind: "docGap", gap }),
    ),
    ...findDescriptionTranslationGaps(registry, { handlerQns, locales }).flatMap(
      (gap): ApiDocsProblem[] =>
        gap.locale === undefined
          ? []
          : [{ kind: "descriptionTranslationMissing", qn: gap.qn, locale: gap.locale }],
    ),
    ...uiWriteProblems(registry, model, config.uiOnlyWrites ?? []),
  );
  return { files, problems: sortApiDocsProblems(problems) };
}
