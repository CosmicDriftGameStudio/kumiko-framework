import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { ScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import type { ReactNode } from "react";
import type { FeatureSchema, NavApi } from "../../../index.ts";
import { NavProvider } from "../../../index.ts";
import {
  atViewportWidth,
  fireEvent,
  render,
  screen,
  setViewportWidth,
  within,
} from "../../__tests__/test-utils.tsx";
import { DefaultPageHeader } from "../../primitives/page-header.tsx";
import { DefaultAppShell } from "../default-app-shell.tsx";
import { ScreenFocus } from "../screen-focus.tsx";

const listScreen: ScreenDefinition = {
  id: "client-list",
  type: "entityList",
  entity: "client",
  columns: [],
};
const detailScreen: ScreenDefinition = {
  id: "client-detail",
  type: "projectionDetail",
  query: "clients:query:detail",
  listScreenId: "client-list",
  layout: { sections: [] },
  focus: true,
} as unknown as ScreenDefinition;
const plainDetailScreen = { ...detailScreen, focus: undefined } as ScreenDefinition;

const schema = {
  featureName: "clients",
  entities: {},
  screens: [listScreen, detailScreen],
  navs: [{ id: "list", label: "Clients", screen: "client-list", icon: "list", order: 10 }],
} as FeatureSchema;

const navigate = mock((_target: unknown) => {});
const nav: NavApi = {
  route: { screenId: "client-detail", entityId: "c1" },
  navigate,
  replace: () => {},
  hrefFor: () => "#",
  searchParams: {},
  setSearchParams: () => {},
};

function Harness({ screenDef }: { readonly screenDef: ScreenDefinition }): ReactNode {
  return (
    <NavProvider value={nav}>
      <DefaultAppShell
        brand={<span>Brand</span>}
        schema={schema}
        headerActions={<button type="button">Global action</button>}
      >
        <ScreenFocus screen={screenDef} screens={[listScreen, detailScreen]}>
          <DefaultPageHeader
            title="Client"
            recordTitle="Anna Beispiel"
            overflowItems={[{ id: "archive", label: "Archive", onSelect: () => {} }]}
          />
        </ScreenFocus>
      </DefaultAppShell>
    </NavProvider>
  );
}

describe("declarative screen focus", () => {
  beforeEach(() => {
    window.localStorage.clear();
    navigate.mockClear();
  });

  test("narrow: the top bar carries the record title, a back arrow to the list and the overflow menu", () => {
    atViewportWidth(500, () => {
      render(<Harness screenDef={detailScreen} />);
      const bar = screen.getByTestId("mobile-top-bar");
      expect(bar.textContent).toContain("Anna Beispiel");
      expect(screen.getByRole("banner").className).toContain("max-md:hidden");
      fireEvent.click(screen.getByTestId("mobile-top-bar-back"));
      expect(navigate).toHaveBeenCalledWith({ screenId: "client-list" });
      expect(screen.getByTestId("mobile-top-bar-actions")).toBeTruthy();
    });
  });

  test("wide: the header stays with the app header actions, the focus rail shows", () => {
    window.localStorage.setItem("kumiko.sidebar.open", "false");
    setViewportWidth(1200);
    render(<Harness screenDef={detailScreen} />);
    expect(screen.getByRole("banner")).toBeTruthy();
    expect(screen.getByText("Global action")).toBeTruthy();
    expect(document.querySelector('[data-kumiko-layout="focus-rail"]')).not.toBeNull();
  });

  test("narrow: the shell's header actions sit in the top bar next to the overflow menu", () => {
    atViewportWidth(500, () => {
      render(<Harness screenDef={detailScreen} />);
      const bar = screen.getByTestId("mobile-top-bar");
      expect(within(bar).getByText("Global action")).toBeTruthy();
      expect(within(bar).getByTestId("mobile-top-bar-actions")).toBeTruthy();
    });
  });

  test("without focus nothing changes: no top bar, header actions stay", () => {
    atViewportWidth(500, () => {
      render(<Harness screenDef={plainDetailScreen} />);
      expect(screen.queryByTestId("mobile-top-bar")).toBeNull();
      expect(screen.getByRole("banner").className).not.toContain("max-md:hidden");
    });
  });
});
