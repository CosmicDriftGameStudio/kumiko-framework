import { describe, expect, test } from "bun:test";
import {
  buildAppSchema,
  createRegistry,
  defineFeature,
  handlerTitleKey,
  handlerTranslationKeys,
  QnTypes,
  qn,
  resolveAgentExposure,
  toKebab,
} from "@cosmicdrift/kumiko-framework/engine";
import { localeDeBundle } from "@cosmicdrift/kumiko-locale-de";
import { localeEsBundle } from "@cosmicdrift/kumiko-locale-es";
import { findHandlerTranslationGaps } from "../../agent-tools/index.ts";
import { createTemplateResolverFeature } from "../feature.ts";
import { collectionHandlerName, TEMPLATE_RESOLVER_FEATURE } from "../web/qualified-names.ts";

const feature = createTemplateResolverFeature();

// The client reads a feature's translations from the app schema, verbatim.
const clientTranslations =
  buildAppSchema(createRegistry([feature])).features.find(
    (schema) => schema.featureName === feature.name,
  )?.translations ?? {};

const agentCallableWriteQns = Object.entries(feature.writeHandlers ?? {})
  .filter(([, def]) => resolveAgentExposure(def, "write").expose)
  .map(([name]) => qn(toKebab(feature.name), QnTypes.write, toKebab(name)));

describe("template-resolver handler titles", () => {
  test("the feature exposes write handlers to the agent at all", () => {
    expect(agentCallableWriteQns).toContain("template-resolver:write:patch-draft");
    expect(agentCallableWriteQns).toContain("template-resolver:write:publish");
  });

  test("every agent-callable write handler has an English title", () => {
    const untitled = agentCallableWriteQns.filter(
      (handlerQn) => clientTranslations[handlerTitleKey(handlerQn)]?.["en"] === undefined,
    );
    expect(untitled).toEqual([]);
  });

  test.each([
    ["de", localeDeBundle],
    ["es", localeEsBundle],
  ] as const)("every agent-callable write handler has a %s title", (_locale, bundle) => {
    const untitled = agentCallableWriteQns.filter(
      (handlerQn) => (bundle[handlerTitleKey(handlerQn)] ?? "").trim() === "",
    );
    expect(untitled).toEqual([]);
  });

  test("the agent lint reports no translation gap for template-resolver", () => {
    expect(findHandlerTranslationGaps([feature])).toEqual([]);
  });

  test("a mounted collection's set handler needs labels the app supplies", () => {
    const withCollection = createTemplateResolverFeature({
      collections: [{ id: "notes", kind: "snippet", nav: { label: "app:nav.notes" } }],
    });
    const appLabels = defineFeature("app-labels", (r) => {
      r.translations({
        keys: handlerTranslationKeys(TEMPLATE_RESOLVER_FEATURE, {
          writes: {
            "notes-set": {
              title: { en: "Save note" },
              fields: {
                slug: { en: "Identifier" },
                locale: { en: "Language" },
                title: { en: "Title" },
                content: { en: "Content" },
                folder: { en: "Folder" },
                createOnly: { en: "Create only" },
                tenantIdOverride: { en: "Target organization" },
              },
            },
          },
        }),
      });
    });
    const setQn = collectionHandlerName("notes");

    expect(findHandlerTranslationGaps([withCollection]).map((gap) => gap.qn)).toContain(setQn);
    expect(
      findHandlerTranslationGaps([withCollection, appLabels]).filter((gap) => gap.qn === setQn),
    ).toEqual([]);
  });
});
