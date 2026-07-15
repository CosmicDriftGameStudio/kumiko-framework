import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  createStaticLocaleResolver,
  LocaleProvider,
  PrimitivesProvider,
} from "@cosmicdrift/kumiko-renderer";
import { defaultPrimitives } from "@cosmicdrift/kumiko-renderer-web";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { TagsHandlers, TagsQueries } from "../../constants";
import { defaultTranslations } from "../i18n";
import { TagSection, tagSelectionDelta } from "../tag-section";

type TagRow = { id: string; name: string; color?: string };
type AssignmentRow = { tagId: string; entityType: string; entityId: string };

let catalogRows: readonly TagRow[] = [];
let assignmentRows: readonly AssignmentRow[] = [];

// Each test sets its own rows; reset so a forgotten setup can't inherit the
// previous test's data (order-dependent shared state).
beforeEach(() => {
  catalogRows = [];
  assignmentRows = [];
  catalogRefetch.mockClear();
  assignmentsRefetch.mockClear();
});

const dispatchSpy = mock(async (type: string) =>
  type === TagsHandlers.createTag
    ? { isSuccess: true, data: { id: "tag-new" } }
    : { isSuccess: true, data: undefined },
);

const catalogRefetch = mock(async () => {});
const assignmentsRefetch = mock(async () => {});
const useQuerySpy = mock((type: string) => ({
  data: type === TagsQueries.tagList ? { rows: catalogRows } : { rows: assignmentRows },
  loading: false,
  error: null,
  refetch: type === TagsQueries.tagList ? catalogRefetch : assignmentsRefetch,
}));

const actual_renderer = await import("@cosmicdrift/kumiko-renderer");
mock.module("@cosmicdrift/kumiko-renderer", () => ({
  ...actual_renderer,
  useDispatcher: mock(() => ({ write: dispatchSpy, query: mock(), batch: mock() })),
  useQuery: useQuerySpy,
}));

// The real picker is a Dialog wrapping TagManager (cmdk/Radix popovers) — its
// interaction is the picker's own test + e2e territory. Here we swap a headless
// stub that just exposes the onChange contract via two buttons, so we can pin
// what TagSection does with a new selection (the assign/remove diff) without
// driving a modal. Same contract as the real picker's onChange.
const StubPicker = ({
  value,
  onChange,
}: {
  readonly value: readonly string[];
  readonly onChange: (next: readonly string[]) => void;
  readonly entityType: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}): ReactNode => (
  <div data-testid="stub-picker">
    <button type="button" data-testid="picker-add-t2" onClick={() => onChange([...value, "t2"])}>
      add t2
    </button>
    <button
      type="button"
      data-testid="picker-add-t2-t3"
      onClick={() => onChange([...value, "t2", "t3"])}
    >
      add t2+t3
    </button>
    <button
      type="button"
      data-testid="picker-remove-t1"
      onClick={() => onChange(value.filter((v) => v !== "t1"))}
    >
      remove t1
    </button>
  </div>
);
mock.module("../tag-picker", () => ({ TagPicker: StubPicker }));

function Wrapper({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <LocaleProvider resolver={createStaticLocaleResolver()} fallbackBundles={[defaultTranslations]}>
      <PrimitivesProvider value={defaultPrimitives}>{children}</PrimitivesProvider>
    </LocaleProvider>
  );
}

// The picker's onChange drives the full new selection; the section diffs it
// against the current assignments via this helper to decide assign vs remove.
describe("tagSelectionDelta", () => {
  test("addition only", () => {
    expect(tagSelectionDelta(["a"], ["a", "b"])).toEqual({ added: ["b"], removed: [] });
  });
  test("removal only", () => {
    expect(tagSelectionDelta(["a", "b"], ["a"])).toEqual({ added: [], removed: ["b"] });
  });
  test("simultaneous add + remove", () => {
    expect(tagSelectionDelta(["a"], ["b"])).toEqual({ added: ["b"], removed: ["a"] });
  });
  test("no change", () => {
    expect(tagSelectionDelta(["a", "b"], ["b", "a"])).toEqual({ added: [], removed: [] });
  });
});

describe("TagSection", () => {
  test("renders assigned tags as colored chips + an Edit-tags button", () => {
    catalogRows = [
      { id: "t1", name: "important", color: "#ef4444" },
      { id: "t2", name: "project-x" },
    ];
    assignmentRows = [{ tagId: "t1", entityType: "note", entityId: "note-1" }];

    render(
      <Wrapper>
        <TagSection entityName="note" entityId="note-1" />
      </Wrapper>,
    );

    expect(screen.getByTestId("tags-section")).toBeTruthy();
    // assigned → chip shown; unassigned t2 is not rendered (it lives in the picker)
    expect(screen.getByText("important")).toBeTruthy();
    expect(screen.queryByText("project-x")).toBeNull();
    expect(screen.getByTestId("tags-section-edit")).toBeTruthy();
  });

  test("no assigned tags → renders no chips, just the Edit-tags button", () => {
    catalogRows = [{ id: "t1", name: "important" }];
    assignmentRows = [];

    render(
      <Wrapper>
        <TagSection entityName="note" entityId="note-1" />
      </Wrapper>,
    );

    expect(screen.queryByTestId("tag-chip")).toBeNull();
    expect(screen.getByTestId("tags-section-edit")).toBeTruthy();
  });

  test("picker selection dispatches assign for additions, remove for removals", async () => {
    catalogRows = [
      { id: "t1", name: "important" },
      { id: "t2", name: "project-x" },
    ];
    assignmentRows = [{ tagId: "t1", entityType: "note", entityId: "note-1" }];
    dispatchSpy.mockClear();

    render(
      <Wrapper>
        <TagSection entityName="note" entityId="note-1" />
      </Wrapper>,
    );

    // t1 assigned → picking [t1, t2] adds t2 → assign-tag
    fireEvent.click(screen.getByTestId("picker-add-t2"));
    await waitFor(() =>
      expect(dispatchSpy).toHaveBeenCalledWith(TagsHandlers.assignTag, {
        tagId: "t2",
        entityType: "note",
        entityId: "note-1",
      }),
    );

    // t1 assigned → picking [] removes t1 → remove-tag
    fireEvent.click(screen.getByTestId("picker-remove-t1"));
    await waitFor(() =>
      expect(dispatchSpy).toHaveBeenCalledWith(TagsHandlers.removeTag, {
        tagId: "t1",
        entityType: "note",
        entityId: "note-1",
      }),
    );
  });

  test("partial write failure still refetches — no stale UI for the writes that succeeded", async () => {
    catalogRows = [
      { id: "t1", name: "important" },
      { id: "t2", name: "project-x" },
      { id: "t3", name: "urgent" },
    ];
    assignmentRows = [{ tagId: "t1", entityType: "note", entityId: "note-1" }];
    dispatchSpy.mockClear();
    dispatchSpy.mockImplementation(async (_type: string, payload?: Record<string, unknown>) =>
      payload?.["tagId"] === "t3"
        ? { isSuccess: false, error: { i18nKey: "tags.error.assignFailed" } }
        : { isSuccess: true, data: undefined },
    );

    render(
      <Wrapper>
        <TagSection entityName="note" entityId="note-1" />
      </Wrapper>,
    );

    // t2 assigns OK, t3 fails — the loop stops, but refetch must still run so
    // the UI reflects the t2 write that already succeeded server-side.
    fireEvent.click(screen.getByTestId("picker-add-t2-t3"));
    await waitFor(() => expect(screen.getByTestId("tags-section-action-error")).toBeTruthy());

    expect(catalogRefetch).toHaveBeenCalled();
    expect(assignmentsRefetch).toHaveBeenCalled();

    dispatchSpy.mockImplementation(async (type: string) =>
      type === TagsHandlers.createTag
        ? { isSuccess: true, data: { id: "tag-new" } }
        : { isSuccess: true, data: undefined },
    );
  });

  test("create-mode (no entityId yet) shows the save-first hint instead of the section", () => {
    render(
      <Wrapper>
        <TagSection entityName="note" entityId={null} />
      </Wrapper>,
    );
    expect(screen.getByTestId("tags-section-create-mode")).toBeTruthy();
    expect(screen.queryByTestId("tags-section")).toBeNull();
  });
});
