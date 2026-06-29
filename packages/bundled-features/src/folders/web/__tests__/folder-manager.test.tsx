import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  createStaticLocaleResolver,
  LocaleProvider,
  PrimitivesProvider,
} from "@cosmicdrift/kumiko-renderer";
import { defaultPrimitives } from "@cosmicdrift/kumiko-renderer-web";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { FoldersHandlers, FoldersQueries } from "../../constants";
import { type FolderFiling, FolderManager } from "../folder-manager";
import { defaultTranslations } from "../i18n";

type FolderRow = { id: string; name: string; parentId: string | null; version: number };

let folderRows: readonly FolderRow[] = [];

beforeEach(() => {
  folderRows = [];
  dispatchSpy.mockClear();
});

const dispatchSpy = mock(async () => ({ isSuccess: true, data: undefined }));

const useQuerySpy = mock((type: string) => ({
  data: type === FoldersQueries.folderList ? { rows: folderRows } : { rows: [] },
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

const filingWith = (onReassigned: () => void): FolderFiling => ({
  entityType: "credit",
  leavesByFolder: new Map([["f1", [{ id: "c-1", label: "Credit 1" }]]]),
  unfiled: [{ id: "c-2", label: "Credit 2" }],
  unfiledLabel: "Unfiled",
  onReassigned,
});

const dropLeaf = (targetTestId: string, entityId: string): void => {
  fireEvent.drop(screen.getByTestId(targetTestId), {
    dataTransfer: { getData: () => entityId },
  });
};

describe("FolderManager filing mode", () => {
  test("renders filed leaves under their folder and the unfiled bucket", () => {
    folderRows = [{ id: "f1", name: "A", parentId: null, version: 1 }];
    render(
      <Wrapper>
        <FolderManager filing={filingWith(() => {})} />
      </Wrapper>,
    );
    expect(screen.getByTestId("folder-leaf-c-1")).toBeTruthy();
    expect(screen.getByTestId("folder-node-unfiled")).toBeTruthy();
    expect(screen.getByTestId("folder-leaf-c-2")).toBeTruthy();
  });

  test("dropping a leaf on another folder dispatches set-folder + refetches the host", async () => {
    folderRows = [
      { id: "f1", name: "A", parentId: null, version: 1 },
      { id: "f2", name: "B", parentId: null, version: 1 },
    ];
    const onReassigned = mock(() => {});
    render(
      <Wrapper>
        <FolderManager filing={filingWith(onReassigned)} />
      </Wrapper>,
    );
    dropLeaf("folder-node-f2", "c-1");
    await waitFor(() =>
      expect(dispatchSpy).toHaveBeenCalledWith(FoldersHandlers.setFolder, {
        folderId: "f2",
        entityType: "credit",
        entityId: "c-1",
      }),
    );
    await waitFor(() => expect(onReassigned).toHaveBeenCalled());
  });

  test("dropping a leaf on the unfiled bucket dispatches clear-folder", async () => {
    folderRows = [{ id: "f1", name: "A", parentId: null, version: 1 }];
    render(
      <Wrapper>
        <FolderManager filing={filingWith(() => {})} />
      </Wrapper>,
    );
    dropLeaf("folder-node-unfiled", "c-1");
    await waitFor(() =>
      expect(dispatchSpy).toHaveBeenCalledWith(FoldersHandlers.clearFolder, {
        entityType: "credit",
        entityId: "c-1",
      }),
    );
  });

  test("dropping a leaf on the folder it already lives in is a no-op (no write)", async () => {
    folderRows = [{ id: "f1", name: "A", parentId: null, version: 1 }];
    render(
      <Wrapper>
        <FolderManager filing={filingWith(() => {})} />
      </Wrapper>,
    );
    dropLeaf("folder-node-f1", "c-1");
    // give any (erroneous) async write a tick to land
    await new Promise((r) => setTimeout(r, 0));
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  test("without filing the manager renders no leaves or bucket (backward compatible)", () => {
    folderRows = [{ id: "f1", name: "A", parentId: null, version: 1 }];
    render(
      <Wrapper>
        <FolderManager />
      </Wrapper>,
    );
    expect(screen.getByTestId("folder-node-f1")).toBeTruthy();
    expect(screen.queryByTestId("folder-node-unfiled")).toBeNull();
    expect(screen.queryByTestId("folder-leaf-c-1")).toBeNull();
  });

  test("delete is confirm-gated; confirming dispatches delete-folder", async () => {
    folderRows = [{ id: "f1", name: "A", parentId: null, version: 1 }];
    render(
      <Wrapper>
        <FolderManager />
      </Wrapper>,
    );
    fireEvent.click(screen.getByTestId("folder-delete-f1"));
    expect(dispatchSpy).not.toHaveBeenCalled(); // no write before confirm
    fireEvent.click(await screen.findByTestId("folder-manager-delete-dialog-confirm"));
    await waitFor(() =>
      expect(dispatchSpy).toHaveBeenCalledWith(FoldersHandlers.deleteFolder, { id: "f1" }),
    );
  });

  test("the in-tree new-folder row opens a draft; submitting (Enter) creates a root folder", async () => {
    folderRows = [];
    render(
      <Wrapper>
        <FolderManager />
      </Wrapper>,
    );
    fireEvent.click(screen.getByTestId("folder-manager-new-root"));
    fireEvent.change(document.getElementById("folder-manager-draft") as HTMLInputElement, {
      target: { value: "Inbox" },
    });
    fireEvent.submit(screen.getByTestId("folder-manager-draft"));
    await waitFor(() =>
      expect(dispatchSpy).toHaveBeenCalledWith(FoldersHandlers.createFolder, { name: "Inbox" }),
    );
  });

  test("a mixed-type tree files each leaf under its own entityType (per-leaf override + fallback)", async () => {
    folderRows = [
      { id: "f1", name: "A", parentId: null, version: 1 },
      { id: "f2", name: "B", parentId: null, version: 1 },
    ];
    const mixed: FolderFiling = {
      entityType: "credit", // tree default
      leavesByFolder: new Map([["f1", [{ id: "b-1", label: "Bauspar 1", entityType: "bauspar" }]]]),
      unfiled: [{ id: "c-1", label: "Credit 1" }], // no override → inherits "credit"
      unfiledLabel: "Unfiled",
      onReassigned: () => {},
    };
    render(
      <Wrapper>
        <FolderManager filing={mixed} />
      </Wrapper>,
    );

    // The bauspar leaf carries its own entityType into the set-folder write…
    dropLeaf("folder-node-f2", "b-1");
    await waitFor(() =>
      expect(dispatchSpy).toHaveBeenCalledWith(FoldersHandlers.setFolder, {
        folderId: "f2",
        entityType: "bauspar",
        entityId: "b-1",
      }),
    );

    // …while a leaf without an override still falls back to filing.entityType.
    dropLeaf("folder-node-f1", "c-1");
    await waitFor(() =>
      expect(dispatchSpy).toHaveBeenCalledWith(FoldersHandlers.setFolder, {
        folderId: "f1",
        entityType: "credit",
        entityId: "c-1",
      }),
    );
  });
});
