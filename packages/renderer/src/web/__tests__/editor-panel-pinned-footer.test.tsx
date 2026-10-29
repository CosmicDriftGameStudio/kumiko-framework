import { describe, expect, test } from "bun:test";
import { render as renderRaw } from "@testing-library/react";
import type { ReactNode } from "react";
import { FormScreenLayout } from "../../components/form-screen-layout.tsx";
import {
  createStaticLocaleResolver,
  LocaleProvider,
  NavProvider,
  PrimitivesProvider,
} from "../../index.ts";
import { useBrowserNavApi } from "../app/nav.tsx";
import { EditorPanel, type ResolverComponent } from "../layout/editor-panel.tsx";
import { defaultPrimitives } from "../primitives/index.tsx";
import { screen } from "./test-utils.tsx";

const FormEditor: ResolverComponent = () => (
  <FormScreenLayout testId="resolver-editor" actions={<button type="submit">Save</button>}>
    <span>fields</span>
  </FormScreenLayout>
);

function Wrapper({ children }: { readonly children: ReactNode }): ReactNode {
  const nav = useBrowserNavApi({ hasWorkspaces: true });
  return (
    <LocaleProvider resolver={createStaticLocaleResolver()}>
      <PrimitivesProvider value={defaultPrimitives}>
        <NavProvider value={nav}>{children}</NavProvider>
      </PrimitivesProvider>
    </LocaleProvider>
  );
}

describe("EditorPanel hosting a FormScreenLayout resolver", () => {
  test("gives the editor a bounded height and keeps its footer outside the scroll surface", () => {
    window.history.replaceState(null, "", "/admin/x?t=demo:edit&a_id=1");
    const { container } = renderRaw(
      <EditorPanel resolvers={new Map([["demo:edit", FormEditor]])} />,
      { wrapper: Wrapper },
    );
    const host = container.querySelector('[data-kumiko-layout="editor-main"]');
    expect(host?.className).toContain("h-full");
    expect(host?.className).toContain("min-h-0");
    expect(host?.className).not.toContain("flex-1");

    expect(screen.getByTestId("resolver-editor-actions")).toBeDefined();
    expect(
      screen
        .getByTestId("resolver-editor-scroll")
        .contains(screen.getByTestId("resolver-editor-actions")),
    ).toBe(false);
  });
});
