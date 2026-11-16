import { beforeEach, describe, expect, mock, test } from "bun:test";
import { entityListSchema } from "@cosmicdrift/kumiko-framework/engine";
import {
  createStaticLocaleResolver,
  LocaleProvider,
  PrimitivesProvider,
} from "@cosmicdrift/kumiko-renderer";
import { defaultPrimitives } from "@cosmicdrift/kumiko-renderer/web";
import { mockModuleForFile } from "@cosmicdrift/kumiko-testing/helpers/mock-module";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { TagsQueries } from "../constants.ts";
import { defaultTranslations } from "../i18n.ts";
import { TagsCell } from "../tags-cell.tsx";

type TagRow = { id: string; name: string; color?: string };
type AssignmentRow = { tagId: string; entityType: string; entityId: string };

let catalogRows: readonly TagRow[] = [];
let assignmentRows: readonly AssignmentRow[] = [];

beforeEach(() => {
  catalogRows = [];
  assignmentRows = [];
});

const useQuerySpy = mock((type: string) => ({
  data: type === TagsQueries.tagList ? { rows: catalogRows } : { rows: assignmentRows },
  loading: false,
  error: null,
  refetch: mock(async () => {}),
}));

mockModuleForFile("@cosmicdrift/kumiko-renderer", await import("@cosmicdrift/kumiko-renderer"), {
  useQuery: useQuerySpy,
});

function Wrapper({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <LocaleProvider resolver={createStaticLocaleResolver()} fallbackBundles={[defaultTranslations]}>
      <PrimitivesProvider value={defaultPrimitives}>{children}</PrimitivesProvider>
    </LocaleProvider>
  );
}

function renderCell(rowId: string): void {
  render(
    <Wrapper>
      <TagsCell value={rowId} row={{ id: rowId }} column={{ field: "tags" }} />
    </Wrapper>,
  );
}

describe("TagsCell", () => {
  test("renders a chip per tag assigned to the row's id, joined to the catalog", () => {
    catalogRows = [
      { id: "t1", name: "important", color: "#ef4444" },
      { id: "t2", name: "project-x", color: "#3b82f6" },
    ];
    assignmentRows = [
      { tagId: "t1", entityType: "note", entityId: "n1" },
      { tagId: "t2", entityType: "note", entityId: "n1" },
      { tagId: "t1", entityType: "note", entityId: "n2" }, // a different row
    ];

    renderCell("n1");

    expect(screen.getByTestId("tags-cell")).toBeTruthy();
    expect(screen.getByText("important")).toBeTruthy();
    expect(screen.getByText("project-x")).toBeTruthy();
  });

  test("renders nothing when the row has no assigned tags", () => {
    catalogRows = [{ id: "t1", name: "important" }];
    assignmentRows = [{ tagId: "t1", entityType: "note", entityId: "other-row" }];

    renderCell("n1");

    expect(screen.queryByTestId("tags-cell")).toBeNull();
  });

  test("renders nothing for an empty row id", () => {
    catalogRows = [{ id: "t1", name: "important" }];
    assignmentRows = [{ tagId: "t1", entityType: "note", entityId: "n1" }];

    render(
      <Wrapper>
        <TagsCell value="" row={{}} column={{ field: "tags" }} />
      </Wrapper>,
    );

    expect(screen.queryByTestId("tags-cell")).toBeNull();
  });
});

describe("TagsCell assignment query", () => {
  test("sends a payload the real list schema accepts, scoped to the row", () => {
    useQuerySpy.mockClear();
    renderCell("n1");

    const call = useQuerySpy.mock.calls.find(([type]) => type === TagsQueries.assignmentList);
    const payload = (call as unknown as [string, unknown])[1];
    expect(entityListSchema.safeParse(payload).success).toBe(true);
    expect(payload).toMatchObject({ filters: [{ field: "entityId", op: "eq", value: "n1" }] });
  });
});
