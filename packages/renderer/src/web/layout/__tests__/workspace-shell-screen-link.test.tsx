import { beforeEach, describe, expect, test } from "bun:test";
import type { ReactNode } from "react";
import { type AppSchema, type FeatureSchema, type NavApi, NavProvider } from "../../../index.ts";
import { render } from "../../__tests__/test-utils.tsx";
import { WorkspaceShell } from "../workspace-shell.tsx";

const feature = {
  featureName: "inbox",
  entities: {},
  screens: [
    { id: "inbox", type: "entityList", entity: "x", columns: [] },
    { id: "connector-pair", type: "entityList", entity: "x", columns: [] },
  ],
  navs: [{ id: "inbox", label: "Posteingang", screen: "inbox", order: 10 }],
} as FeatureSchema;

const app: AppSchema = {
  features: [feature],
  workspaces: [
    { definition: { id: "main", label: "Main", default: true }, navMembers: ["inbox:nav:inbox"] },
  ],
};

type Route = NonNullable<NavApi["route"]>;

function renderAt(route: Route): { replace: unknown[][] } {
  const replace: unknown[][] = [];
  const nav: NavApi = {
    route,
    navigate: () => {},
    replace: (...args) => {
      replace.push(args);
    },
    hrefFor: () => "",
    searchParams: { userCode: "X" },
    setSearchParams: () => {},
  };
  const tree: ReactNode = (
    <NavProvider value={nav}>
      <WorkspaceShell brand={<span>Brand</span>} schema={app}>
        <span>Body</span>
      </WorkspaceShell>
    </NavProvider>
  );
  render(tree);
  return { replace };
}

describe("WorkspaceShell workspace-less screen links", () => {
  beforeEach(() => window.localStorage.clear());

  test("a link without workspace keeps its screen and query under the active workspace", () => {
    const { replace } = renderAt({ workspaceId: "connector-pair", screenId: "" });
    expect(replace).toEqual([
      [{ workspaceId: "main", screenId: "connector-pair" }, { searchParams: { userCode: "X" } }],
    ]);
  });

  test("an unknown first segment falls back to the default screen of the active workspace", () => {
    const { replace } = renderAt({ workspaceId: "unbekannt", screenId: "" });
    expect(replace).toEqual([[{ workspaceId: "main", screenId: "inbox" }]]);
  });
});
