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
import { FolderSection } from "../folder-section";
import { defaultTranslations } from "../i18n";

type FolderRow = { id: string; name: string; parentId: string | null; version: number };
type AssignmentRow = { folderId: string; entityType: string; entityId: string };

let folderRows: readonly FolderRow[] = [];
let assignmentRows: readonly AssignmentRow[] = [];

beforeEach(() => {
  folderRows = [];
  assignmentRows = [];
});

const dispatchSpy = mock(async (type: string) =>
  type === FoldersHandlers.createFolder
    ? { isSuccess: true, data: { id: "folder-new" } }
    : { isSuccess: true, data: undefined },
);

const useQuerySpy = mock((type: string) => ({
  data: type === FoldersQueries.folderList ? { rows: folderRows } : { rows: assignmentRows },
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

// The real combobox is cmdk + Radix (popover = e2e/primitive-test territory).
// A headless single-select stub renders one button per option and fires
// onChange(value) — same contract, no popover — so the select/clear → set/clear
// wiring is pinnable in jsdom.
const StubInput: typeof defaultPrimitives.Input = (props) => {
  if (props.kind === "combobox" && props.multiple !== true) {
    return (
      <div data-testid="stub-combobox">
        {props.options.map((o) => (
          <button
            key={o.value}
            type="button"
            data-testid={`folder-opt-${o.value === "" ? "none" : o.value}`}
            onClick={() => props.onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    );
  }
  return <input data-testid={`stub-${props.id}`} />;
};

function StubComboboxWrapper({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <LocaleProvider resolver={createStaticLocaleResolver()} fallbackBundles={[defaultTranslations]}>
      <PrimitivesProvider value={{ ...defaultPrimitives, Input: StubInput }}>
        {children}
      </PrimitivesProvider>
    </LocaleProvider>
  );
}

describe("FolderSection", () => {
  test("options carry the full folder path (not just the leaf name)", () => {
    folderRows = [
      { id: "f1", name: "Immobilie", parentId: null, version: 1 },
      { id: "f2", name: "Müller", parentId: "f1", version: 1 },
    ];
    assignmentRows = [{ folderId: "f1", entityType: "credit", entityId: "c-1" }];

    render(
      <StubComboboxWrapper>
        <FolderSection entityName="credit" entityId="c-1" />
      </StubComboboxWrapper>,
    );
    expect(screen.getByText("Immobilie / Müller")).toBeTruthy();
  });

  test("selecting a different folder dispatches set-folder", async () => {
    folderRows = [
      { id: "f1", name: "A", parentId: null, version: 1 },
      { id: "f2", name: "B", parentId: null, version: 1 },
    ];
    assignmentRows = [{ folderId: "f1", entityType: "credit", entityId: "c-1" }];
    dispatchSpy.mockClear();

    render(
      <StubComboboxWrapper>
        <FolderSection entityName="credit" entityId="c-1" />
      </StubComboboxWrapper>,
    );
    fireEvent.click(screen.getByTestId("folder-opt-f2"));
    await waitFor(() =>
      expect(dispatchSpy).toHaveBeenCalledWith(FoldersHandlers.setFolder, {
        folderId: "f2",
        entityType: "credit",
        entityId: "c-1",
      }),
    );
  });

  test("selecting the no-folder option dispatches clear-folder", async () => {
    folderRows = [{ id: "f1", name: "A", parentId: null, version: 1 }];
    assignmentRows = [{ folderId: "f1", entityType: "credit", entityId: "c-1" }];
    dispatchSpy.mockClear();

    render(
      <StubComboboxWrapper>
        <FolderSection entityName="credit" entityId="c-1" />
      </StubComboboxWrapper>,
    );
    fireEvent.click(screen.getByTestId("folder-opt-none"));
    await waitFor(() =>
      expect(dispatchSpy).toHaveBeenCalledWith(FoldersHandlers.clearFolder, {
        entityType: "credit",
        entityId: "c-1",
      }),
    );
  });

  test("create-and-file dispatches create-folder, then set-folder with the new id", async () => {
    folderRows = [];
    assignmentRows = [];
    dispatchSpy.mockClear();

    render(
      <Wrapper>
        <FolderSection entityName="credit" entityId="c-9" />
      </Wrapper>,
    );
    fireEvent.change(document.getElementById("folder-section-new") as HTMLInputElement, {
      target: { value: "Neuer" },
    });
    fireEvent.click(screen.getByTestId("folder-section-create"));

    await waitFor(() =>
      expect(dispatchSpy).toHaveBeenCalledWith(FoldersHandlers.createFolder, { name: "Neuer" }),
    );
    await waitFor(() =>
      expect(dispatchSpy).toHaveBeenCalledWith(FoldersHandlers.setFolder, {
        folderId: "folder-new",
        entityType: "credit",
        entityId: "c-9",
      }),
    );
  });

  test("create-mode (no entityId yet) shows the save-first hint instead of the picker", () => {
    render(
      <Wrapper>
        <FolderSection entityName="credit" entityId={null} />
      </Wrapper>,
    );
    expect(screen.getByTestId("folder-section-create-mode")).toBeTruthy();
    expect(screen.queryByTestId("folder-section")).toBeNull();
  });
});
