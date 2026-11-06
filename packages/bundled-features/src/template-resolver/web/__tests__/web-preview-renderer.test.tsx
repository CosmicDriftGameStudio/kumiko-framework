import { describe, expect, mock, test } from "bun:test";
import {
  createStaticLocaleResolver,
  kumikoDefaultTranslations,
  LocaleProvider,
  PrimitivesProvider,
} from "@cosmicdrift/kumiko-renderer";
import { defaultPrimitives } from "@cosmicdrift/kumiko-renderer/web";
import { mockModuleForFile } from "@cosmicdrift/kumiko-testing/helpers/mock-module";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { defaultTranslations } from "../i18n.ts";

const useQuery = mock((_queryName: string, _input: unknown) => ({ data: null, error: null }));

mockModuleForFile("@cosmicdrift/kumiko-renderer", await import("@cosmicdrift/kumiko-renderer"), {
  useQuery,
});

const { WebPreviewRenderer } = await import("../web-preview-renderer.tsx");

function Wrapper({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <LocaleProvider
      resolver={createStaticLocaleResolver({ locale: "en" })}
      fallbackBundles={[kumikoDefaultTranslations, defaultTranslations]}
    >
      <PrimitivesProvider value={defaultPrimitives}>{children}</PrimitivesProvider>
    </LocaleProvider>
  );
}

describe("WebPreviewRenderer", () => {
  test("a document body is sent with its variable chips replaced by the example values", () => {
    useQuery.mockClear();
    render(
      <WebPreviewRenderer
        content={'<p>Hi <span data-variable="customerName">x</span></p>'}
        editFormat="document"
        variables={{ customerName: "Max" }}
        subject={{ kind: "body" }}
      />,
      { wrapper: Wrapper },
    );
    const [, input] = useQuery.mock.calls[0] ?? [];
    expect(input).toEqual({ body: "<p>Hi Max</p>", bodyFormat: "document" });
  });

  test("a plain-text body keeps its placeholders filled as Markdown", () => {
    useQuery.mockClear();
    render(
      <WebPreviewRenderer
        content="Hallo {{customerName}}"
        editFormat="plain"
        variables={{ customerName: "Max" }}
        subject={{ kind: "body" }}
      />,
      { wrapper: Wrapper },
    );
    const [, input] = useQuery.mock.calls[0] ?? [];
    expect(input).toEqual({ body: "Hallo Max", bodyFormat: "markdown" });
  });
});
