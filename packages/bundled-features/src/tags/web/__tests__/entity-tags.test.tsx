import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  createStaticLocaleResolver,
  LocaleProvider,
  PrimitivesProvider,
} from "@cosmicdrift/kumiko-renderer";
import { defaultPrimitives } from "@cosmicdrift/kumiko-renderer-web";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { TagsQueries } from "../../constants";
import { EntityTags } from "../entity-tags";
import { defaultTranslations } from "../i18n";

type TagRow = { id: string; name: string; color?: string };
type AssignmentRow = { tagId: string; entityType: string; entityId: string };

let catalogRows: readonly TagRow[] = [];
let assignmentRows: readonly AssignmentRow[] = [];

beforeEach(() => {
  catalogRows = [];
  assignmentRows = [];
});

const useQuerySpy = mock((type: string, _payload?: unknown) => ({
  data: type === TagsQueries.tagList ? { rows: catalogRows } : { rows: assignmentRows },
  loading: false,
  error: null,
  refetch: mock(async () => {}),
}));

const actual_renderer = await import("@cosmicdrift/kumiko-renderer");
mock.module("@cosmicdrift/kumiko-renderer", () => ({
  ...actual_renderer,
  useQuery: useQuerySpy,
}));

function Wrapper({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <LocaleProvider resolver={createStaticLocaleResolver()} fallbackBundles={[defaultTranslations]}>
      <PrimitivesProvider value={defaultPrimitives}>{children}</PrimitivesProvider>
    </LocaleProvider>
  );
}

describe("EntityTags", () => {
  test("renders a chip per assigned tag, joined to the catalog by id", () => {
    catalogRows = [
      { id: "t1", name: "important", color: "#ef4444" },
      { id: "t2", name: "project-x", color: "#3b82f6" },
    ];
    assignmentRows = [
      { tagId: "t1", entityType: "note", entityId: "n1" },
      { tagId: "t2", entityType: "note", entityId: "n1" },
    ];

    render(
      <Wrapper>
        <EntityTags entityName="note" entityId="n1" />
      </Wrapper>,
    );

    expect(screen.getByTestId("entity-tags")).toBeTruthy();
    expect(screen.getByText("important")).toBeTruthy();
    expect(screen.getByText("project-x")).toBeTruthy();
  });

  test("renders nothing when the entity has no assignments", () => {
    catalogRows = [{ id: "t1", name: "important" }];
    assignmentRows = [];

    render(
      <Wrapper>
        <EntityTags entityName="note" entityId="n1" />
      </Wrapper>,
    );

    expect(screen.queryByTestId("entity-tags")).toBeNull();
    expect(screen.queryByTestId("tag-chip")).toBeNull();
  });

  test("scopes the assignment query to this entityType and id server-side", () => {
    catalogRows = [{ id: "t1", name: "important" }];
    assignmentRows = [{ tagId: "t1", entityType: "note", entityId: "n1" }];
    useQuerySpy.mockClear();

    render(
      <Wrapper>
        <EntityTags entityName="note" entityId="n1" />
      </Wrapper>,
    );

    // Filtering server-side (rather than discarding foreign rows after the
    // fetch) is what lets the parent-ref read gate narrow to one host entity.
    const call = useQuerySpy.mock.calls.find((c) => c[0] === TagsQueries.assignmentList);
    expect(call?.[1]).toEqual({
      filters: [
        { field: "entityType", op: "eq", value: "note" },
        { field: "entityId", op: "eq", value: "n1" },
      ],
    });
  });

  test("renders nothing for a not-yet-saved entity (entityId null)", () => {
    catalogRows = [{ id: "t1", name: "important" }];
    assignmentRows = [{ tagId: "t1", entityType: "note", entityId: "n1" }];

    render(
      <Wrapper>
        <EntityTags entityName="note" entityId={null} />
      </Wrapper>,
    );

    expect(screen.queryByTestId("entity-tags")).toBeNull();
  });
});
