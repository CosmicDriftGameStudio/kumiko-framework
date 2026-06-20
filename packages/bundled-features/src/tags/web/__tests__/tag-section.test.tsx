import { describe, expect, mock, test } from "bun:test";
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

type TagRow = { id: string; name: string };
type AssignmentRow = { tagId: string; entityType: string; entityId: string };

let catalogRows: readonly TagRow[] = [];
let assignmentRows: readonly AssignmentRow[] = [];

const dispatchSpy = mock(async (type: string) =>
  type === TagsHandlers.createTag
    ? { isSuccess: true, data: { id: "tag-new" } }
    : { isSuccess: true, data: undefined },
);

const useQuerySpy = mock((type: string) => ({
  data: type === TagsQueries.tagList ? { rows: catalogRows } : { rows: assignmentRows },
  loading: false,
  error: null,
  refetch: mock(async () => {}),
}));

const actual_renderer = await import("@cosmicdrift/kumiko-renderer");
mock.module("@cosmicdrift/kumiko-renderer", () => ({
  ...actual_renderer,
  useDispatcher: mock(() => ({ write: dispatchSpy, query: mock(), batch: mock() })),
  useQuery: useQuerySpy,
}));

function Wrapper({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <LocaleProvider resolver={createStaticLocaleResolver()} fallbackBundles={[defaultTranslations]}>
      <PrimitivesProvider value={defaultPrimitives}>{children}</PrimitivesProvider>
    </LocaleProvider>
  );
}

// The combobox's assign/remove toggle drives onChange with the full new
// selection; the component diffs it against the current tags via this helper.
// Popover interaction itself (cmdk + Radix in jsdom) is covered by the
// combobox primitive's own tests + e2e — here we pin the diff that turns a
// selection into assign/remove calls.
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
  test("renders assigned tags as combobox chips", () => {
    catalogRows = [
      { id: "t1", name: "important" },
      { id: "t2", name: "project-x" },
    ];
    assignmentRows = [{ tagId: "t1", entityType: "note", entityId: "note-1" }];

    render(
      <Wrapper>
        <TagSection entityName="note" entityId="note-1" />
      </Wrapper>,
    );

    expect(screen.getByTestId("combobox-tags-section-select")).toBeTruthy();
    // assigned → chip shown in the trigger; unassigned t2 lives in the (closed) dropdown
    expect(screen.getByText("important")).toBeTruthy();
    expect(screen.queryByText("project-x")).toBeNull();
  });

  test("create-and-attach dispatches create-tag, then assign-tag with the new id", async () => {
    catalogRows = [];
    assignmentRows = [];
    dispatchSpy.mockClear();

    render(
      <Wrapper>
        <TagSection entityName="note" entityId="note-9" />
      </Wrapper>,
    );

    fireEvent.change(document.getElementById("tags-section-new") as HTMLInputElement, {
      target: { value: "urgent" },
    });
    fireEvent.click(screen.getByTestId("tags-section-create"));

    await waitFor(() =>
      expect(dispatchSpy).toHaveBeenCalledWith(TagsHandlers.createTag, { name: "urgent" }),
    );
    await waitFor(() =>
      expect(dispatchSpy).toHaveBeenCalledWith(TagsHandlers.assignTag, {
        tagId: "tag-new",
        entityType: "note",
        entityId: "note-9",
      }),
    );
  });

  test("create-mode (no entityId yet) shows the save-first hint instead of the manager", () => {
    render(
      <Wrapper>
        <TagSection entityName="note" entityId={null} />
      </Wrapper>,
    );
    expect(screen.getByTestId("tags-section-create-mode")).toBeTruthy();
    expect(screen.queryByTestId("tags-section")).toBeNull();
  });
});
