import { describe, expect, mock, test } from "bun:test";
import {
  createStaticLocaleResolver,
  kumikoDefaultTranslations,
  LocaleProvider,
  PrimitivesProvider,
} from "@cosmicdrift/kumiko-renderer";
import { defaultPrimitives } from "@cosmicdrift/kumiko-renderer/web";
import { mockModuleForFile } from "@cosmicdrift/kumiko-testing/helpers/mock-module";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { defaultTranslations } from "../i18n.ts";

const useQuery = mock();

mockModuleForFile("@cosmicdrift/kumiko-renderer", await import("@cosmicdrift/kumiko-renderer"), {
  useQuery,
});

const { SnippetPreviewRenderer } = await import("../snippet-preview-renderer.tsx");

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

describe("SnippetPreviewRenderer", () => {
  test("a document entry shows its example values without calling the admin-only body preview", () => {
    useQuery.mockClear();
    render(
      <SnippetPreviewRenderer
        content={'<p>Hi <span data-variable="customerName">x</span>, <b>thanks</b></p>'}
        editFormat="document"
        variables={{ customerName: "Max <Mustermann>" }}
        subject={{ kind: "body" }}
      />,
      { wrapper: Wrapper },
    );
    const frame = screen.getByTestId("web-preview-iframe") as HTMLIFrameElement;
    expect(frame.srcdoc).toContain("Hi Max &lt;Mustermann&gt;");
    expect(frame.srcdoc).toContain("<b>thanks</b>");
    expect(useQuery).not.toHaveBeenCalled();
    expect(screen.queryByTestId("web-preview-device-switch")).toBeNull();
  });
});
