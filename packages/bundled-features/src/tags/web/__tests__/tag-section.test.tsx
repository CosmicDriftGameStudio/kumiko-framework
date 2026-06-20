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
import { TagSection } from "../tag-section";

type TagRow = { id: string; name: string };
type AssignmentRow = { tagId: string; entityType: string; entityId: string };

let catalogRows: readonly TagRow[] = [];
let assignmentRows: readonly AssignmentRow[] = [];

// createTag returns the new id; assign/remove return data-less success.
const dispatchSpy = mock(async (type: string) =>
  type === TagsHandlers.createTag
    ? { isSuccess: true, data: { id: "tag-new" } }
    : { isSuccess: true, data: undefined },
);

// useQuery is called twice (catalog + assignments) — branch on the QN.
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

describe("TagSection", () => {
  test("shows assigned + available tags and dispatches assign/remove with the right QN + payload", async () => {
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

    // Assigned tag → remove button; unassigned catalog tag → assign button.
    expect(screen.getByTestId("tags-section-remove-t1")).toBeTruthy();
    expect(screen.getByTestId("tags-section-assign-t2")).toBeTruthy();
    expect(screen.queryByTestId("tags-section-assign-t1")).toBeNull();

    fireEvent.click(screen.getByTestId("tags-section-assign-t2"));
    await waitFor(() =>
      expect(dispatchSpy).toHaveBeenCalledWith(TagsHandlers.assignTag, {
        tagId: "t2",
        entityType: "note",
        entityId: "note-1",
      }),
    );

    fireEvent.click(screen.getByTestId("tags-section-remove-t1"));
    await waitFor(() =>
      expect(dispatchSpy).toHaveBeenCalledWith(TagsHandlers.removeTag, {
        tagId: "t1",
        entityType: "note",
        entityId: "note-1",
      }),
    );
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
