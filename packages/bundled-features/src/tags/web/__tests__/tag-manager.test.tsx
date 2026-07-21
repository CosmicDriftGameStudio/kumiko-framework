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
import { TagManager } from "../tag-manager";

type TagRow = { id: string; name: string; color?: string; scope?: string; version: number };
type AssignmentRow = { tagId: string };

let catalogRows: readonly TagRow[] = [];
let assignmentRows: readonly AssignmentRow[] = [];
let catalogLoading = false;
let catalogData: { rows: readonly TagRow[] } | null = { rows: catalogRows };
let catalogError: { i18nKey: string; i18nParams?: Record<string, unknown> } | null = null;
let assignmentError: { i18nKey: string; i18nParams?: Record<string, unknown> } | null = null;

beforeEach(() => {
  catalogRows = [{ id: "t1", name: "urgent", color: "#ef4444", version: 1 }];
  assignmentRows = [{ tagId: "t1" }, { tagId: "t1" }];
  catalogLoading = false;
  catalogData = { rows: catalogRows };
  catalogError = null;
  assignmentError = null;
  dispatchSpy.mockClear();
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

const useQuerySpy = mock((type: string) => {
  if (type === TagsQueries.tagList) {
    return {
      data: catalogData,
      loading: catalogLoading,
      error: catalogError,
      refetch: catalogRefetch,
    };
  }
  return {
    data: { rows: assignmentRows },
    loading: false,
    error: assignmentError,
    refetch: assignmentsRefetch,
  };
});

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

describe("TagManager — loading and errors", () => {
  test("shows loading banner while catalog is loading with no data yet", () => {
    catalogLoading = true;
    catalogData = null;
    render(
      <Wrapper>
        <TagManager />
      </Wrapper>,
    );
    expect(screen.getByTestId("tag-manager-loading")).toBeTruthy();
  });

  test("shows error banner when catalog query fails", () => {
    catalogError = { i18nKey: "tags.section.empty" };
    render(
      <Wrapper>
        <TagManager />
      </Wrapper>,
    );
    expect(screen.getByTestId("tag-manager-error")).toBeTruthy();
    expect(screen.getByText("No tags found.")).toBeTruthy();
  });

  test("shows empty banner when catalog has no rows", () => {
    catalogRows = [];
    catalogData = { rows: catalogRows };
    render(
      <Wrapper>
        <TagManager />
      </Wrapper>,
    );
    expect(screen.getByTestId("tag-manager-empty")).toBeTruthy();
  });
});

describe("TagManager — catalog CRUD", () => {
  test("renders tag row with scope label and usage count", () => {
    catalogRows = [{ id: "t2", name: "note-tag", color: "#22c55e", scope: "note", version: 1 }];
    catalogData = { rows: catalogRows };
    assignmentRows = [{ tagId: "t2" }];
    render(
      <Wrapper>
        <TagManager />
      </Wrapper>,
    );
    expect(screen.getByTestId("tag-manager-row-t2")).toBeTruthy();
    expect(screen.getByText("@note")).toBeTruthy();
    expect(screen.getByText("1×")).toBeTruthy();
  });

  test("create dispatches write with trimmed name/color/scope and refetches", async () => {
    render(
      <Wrapper>
        <TagManager />
      </Wrapper>,
    );
    fireEvent.change(document.getElementById("tag-manager-new-name") as HTMLInputElement, {
      target: { value: "  new-tag  " },
    });
    fireEvent.click(screen.getByTestId("tag-manager-new-color-swatch-#22c55e"));
    fireEvent.change(document.getElementById("tag-manager-new-scope") as HTMLInputElement, {
      target: { value: " note " },
    });
    fireEvent.click(screen.getByTestId("tag-manager-create"));

    await waitFor(() =>
      expect(dispatchSpy).toHaveBeenCalledWith(TagsHandlers.createTag, {
        name: "new-tag",
        color: "#22c55e",
        scope: "note",
      }),
    );
    await waitFor(() => expect(catalogRefetch).toHaveBeenCalled());
    await waitFor(() => expect(assignmentsRefetch).toHaveBeenCalled());
  });

  test("create button stays disabled for empty trimmed name", () => {
    render(
      <Wrapper>
        <TagManager />
      </Wrapper>,
    );
    const create = screen.getByTestId("tag-manager-create") as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    fireEvent.change(document.getElementById("tag-manager-new-name") as HTMLInputElement, {
      target: { value: "   " },
    });
    expect(create.disabled).toBe(true);
  });

  test("save edit dispatches update and closes edit form", async () => {
    render(
      <Wrapper>
        <TagManager />
      </Wrapper>,
    );
    fireEvent.click(screen.getByTestId("tag-manager-edit-btn-t1"));
    expect(screen.getByTestId("tag-manager-edit-t1")).toBeTruthy();

    fireEvent.change(document.getElementById("tag-edit-name-t1") as HTMLInputElement, {
      target: { value: "renamed" },
    });
    fireEvent.click(screen.getByTestId("tag-edit-color-t1-swatch-#3b82f6"));
    fireEvent.click(screen.getByTestId("tag-manager-save-t1"));

    await waitFor(() =>
      expect(dispatchSpy).toHaveBeenCalledWith(TagsHandlers.updateTag, {
        id: "t1",
        version: 1,
        name: "renamed",
        color: "#3b82f6",
        scope: "",
      }),
    );
    await waitFor(() => expect(screen.queryByTestId("tag-manager-edit-t1")).toBeNull());
  });

  test("cancel edit closes edit form without write", () => {
    render(
      <Wrapper>
        <TagManager />
      </Wrapper>,
    );
    fireEvent.click(screen.getByTestId("tag-manager-edit-btn-t1"));
    fireEvent.click(screen.getByText("Cancel"));
    expect(screen.queryByTestId("tag-manager-edit-t1")).toBeNull();
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  test("delete confirm dispatches deleteTag and refetches", async () => {
    render(
      <Wrapper>
        <TagManager />
      </Wrapper>,
    );
    fireEvent.click(screen.getByTestId("tag-manager-delete-btn-t1"));
    expect(screen.getByTestId("tag-manager-delete-dialog")).toBeTruthy();
    fireEvent.click(screen.getByTestId("tag-manager-delete-dialog-confirm"));

    await waitFor(() =>
      expect(dispatchSpy).toHaveBeenCalledWith(TagsHandlers.deleteTag, { id: "t1" }),
    );
    await waitFor(() => expect(catalogRefetch).toHaveBeenCalled());
  });

  test("failed write shows action error banner", async () => {
    dispatchSpy.mockImplementationOnce(async () => ({
      isSuccess: false,
      error: { i18nKey: "tags.section.empty" },
    }));
    render(
      <Wrapper>
        <TagManager />
      </Wrapper>,
    );
    fireEvent.change(document.getElementById("tag-manager-new-name") as HTMLInputElement, {
      target: { value: "fail-tag" },
    });
    fireEvent.click(screen.getByTestId("tag-manager-create"));

    await waitFor(() => expect(screen.getByTestId("tag-manager-action-error")).toBeTruthy());
  });
});

// 695/4: saveEdit silently no-ops on an empty trimmed name — the Save button
// must reflect that in its disabled state, not just in the click handler.
describe("TagManager — edit Save button", () => {
  test("Save is disabled once the name is cleared to empty/whitespace", () => {
    render(
      <Wrapper>
        <TagManager />
      </Wrapper>,
    );
    fireEvent.click(screen.getByTestId("tag-manager-edit-btn-t1"));

    const save = screen.getByTestId("tag-manager-save-t1") as HTMLButtonElement;
    expect(save.disabled).toBe(false);

    const nameInput = document.getElementById("tag-edit-name-t1") as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "   " } });
    expect(save.disabled).toBe(true);

    fireEvent.change(nameInput, { target: { value: "renamed" } });
    expect(save.disabled).toBe(false);
  });
});

describe("TagManager — selection mode", () => {
  test("filters tags by entityType scope and toggles selection", () => {
    catalogRows = [
      { id: "t1", name: "global", version: 1 },
      { id: "t2", name: "note-only", scope: "note", version: 1 },
      { id: "t3", name: "other", scope: "task", version: 1 },
    ];
    catalogData = { rows: catalogRows };
    const onChange = mock((next: readonly string[]) => next);
    let selected: readonly string[] = ["t1"];

    render(
      <Wrapper>
        <TagManager
          entityType="note"
          selection={{
            value: selected,
            onChange: (next) => {
              selected = next;
              onChange(next);
            },
          }}
        />
      </Wrapper>,
    );

    expect(screen.getByTestId("tag-manager-row-t1")).toBeTruthy();
    expect(screen.getByTestId("tag-manager-row-t2")).toBeTruthy();
    expect(screen.queryByTestId("tag-manager-row-t3")).toBeNull();
    expect(screen.queryByTestId("tag-manager-new-scope")).toBeNull();

    fireEvent.click(screen.getByTestId("tag-manager-toggle-t2"));
    expect(onChange).toHaveBeenCalledWith(["t1", "t2"]);

    fireEvent.click(screen.getByTestId("tag-manager-toggle-t1"));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  test("create in selection mode adds new tag id to selection", async () => {
    const onChange = mock((next: readonly string[]) => next);
    render(
      <Wrapper>
        <TagManager entityType="note" selection={{ value: [], onChange }} />
      </Wrapper>,
    );
    fireEvent.change(document.getElementById("tag-manager-new-name") as HTMLInputElement, {
      target: { value: "picked" },
    });
    fireEvent.click(screen.getByTestId("tag-manager-create"));

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(["tag-new"]));
  });

  test("delete removes tag from selection when it was selected", async () => {
    const onChange = mock((next: readonly string[]) => next);
    render(
      <Wrapper>
        <TagManager selection={{ value: ["t1"], onChange }} />
      </Wrapper>,
    );
    fireEvent.click(screen.getByTestId("tag-manager-delete-btn-t1"));
    fireEvent.click(screen.getByTestId("tag-manager-delete-dialog-confirm"));

    await waitFor(() => expect(onChange).toHaveBeenCalledWith([]));
  });
});
