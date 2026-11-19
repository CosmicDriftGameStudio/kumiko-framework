import { beforeEach, describe, expect, mock, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { entityListSchema } from "@cosmicdrift/kumiko-framework/engine";
import {
  createStaticLocaleResolver,
  LocaleProvider,
  PrimitivesProvider,
} from "@cosmicdrift/kumiko-renderer";
import { defaultPrimitives } from "@cosmicdrift/kumiko-renderer/web";
import { mockModuleForFile } from "@cosmicdrift/kumiko-testing/helpers/mock-module";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { TagsQueries } from "../constants.ts";
import { defaultTranslations } from "../i18n.ts";
import { TagFilter } from "../tag-filter.tsx";

type TagRow = { id: string; name: string; color?: string };
type AssignmentRow = { tagId: string; entityType: string; entityId: string };

let catalogRows: readonly TagRow[] = [];
let assignmentRows: readonly AssignmentRow[] = [];
const setFilterSpy = mock((_field: string, _values: readonly string[]) => {});

beforeEach(() => {
  catalogRows = [
    { id: "t1", name: "urgent", color: "#ef4444" },
    { id: "t2", name: "backend", color: "#3b82f6" },
  ];
  assignmentRows = [
    { tagId: "t1", entityType: "note", entityId: "n1" },
    { tagId: "t2", entityType: "note", entityId: "n2" },
  ];
  setFilterSpy.mockClear();
});

const useQuerySpy = mock((type: string) => ({
  data: type === TagsQueries.tagList ? { rows: catalogRows } : { rows: assignmentRows },
  loading: false,
  error: null,
  refetch: mock(async () => {}),
}));

mockModuleForFile("@cosmicdrift/kumiko-renderer", await import("@cosmicdrift/kumiko-renderer"), {
  useQuery: useQuerySpy,
  useListUrlState: () => ({
    sort: null,
    q: "",
    page: 1,
    filters: {},
    setSort: mock(() => {}),
    setQ: mock(() => {}),
    setPage: mock(() => {}),
    setFilter: setFilterSpy,
    clearFilters: mock(() => {}),
  }),
});

// Headless picker stub: a button that reports a tag selection back through the
// real onChange contract — no Dialog/cmdk popover to drive.
const StubPicker = ({
  onChange,
}: {
  readonly value: readonly string[];
  readonly onChange: (next: readonly string[]) => void;
  readonly entityType: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}): ReactNode => (
  <button type="button" data-testid="picker-pick-t1" onClick={() => onChange(["t1"])}>
    pick urgent
  </button>
);
mockModuleForFile(
  fileURLToPath(new URL("../tag-picker.tsx", import.meta.url)),
  await import("../tag-picker.tsx"),
  { TagPicker: StubPicker },
);

function Wrapper({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <LocaleProvider resolver={createStaticLocaleResolver()} fallbackBundles={[defaultTranslations]}>
      <PrimitivesProvider value={defaultPrimitives}>{children}</PrimitivesProvider>
    </LocaleProvider>
  );
}

describe("TagFilter", () => {
  test("idle → just the filter button, no chips, no clear", () => {
    render(
      <Wrapper>
        <TagFilter entityName="note" screenId="note-list" />
      </Wrapper>,
    );
    screen.getByTestId("tag-filter-open");
    expect(screen.queryByTestId("tag-chip")).toBeNull();
    expect(screen.queryByTestId("tag-filter-clear")).toBeNull();
  });

  test("picking a tag → narrows the list to its entity ids + shows the selected chip + clear", () => {
    render(
      <Wrapper>
        <TagFilter entityName="note" screenId="note-list" />
      </Wrapper>,
    );

    fireEvent.click(screen.getByTestId("picker-pick-t1"));

    // urgent (t1) is assigned to n1 → list narrows to that id set
    expect(setFilterSpy).toHaveBeenCalledWith("id", ["n1"]);
    // the active selection is visible as a chip + a clear affordance
    screen.getByText("urgent");
    screen.getByTestId("tag-filter-clear");
  });

  test("clear → drops the filter and the chip", () => {
    render(
      <Wrapper>
        <TagFilter entityName="note" screenId="note-list" />
      </Wrapper>,
    );
    fireEvent.click(screen.getByTestId("picker-pick-t1"));
    setFilterSpy.mockClear();

    fireEvent.click(screen.getByTestId("tag-filter-clear"));

    expect(setFilterSpy).toHaveBeenCalledWith("id", []);
    expect(screen.queryByText("urgent")).toBeNull();
  });
});

describe("TagFilter assignment query", () => {
  test("sends a payload the real list schema accepts, scoped to the host entity", () => {
    useQuerySpy.mockClear();
    render(
      <Wrapper>
        <TagFilter entityName="note" screenId="note-list" />
      </Wrapper>,
    );

    const call = useQuerySpy.mock.calls.find(([type]) => type === TagsQueries.assignmentList);
    const payload = (call as unknown as [string, unknown])[1];
    expect(entityListSchema.safeParse(payload).success).toBe(true);
    expect(payload).toMatchObject({
      filters: [{ field: "entityType", op: "eq", value: "note" }],
    });
  });
});
