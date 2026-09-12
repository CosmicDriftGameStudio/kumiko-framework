import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  createStaticLocaleResolver,
  LocaleProvider,
  PrimitivesProvider,
} from "@cosmicdrift/kumiko-renderer";
import { defaultPrimitives } from "@cosmicdrift/kumiko-renderer-web";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type ReactNode, useState } from "react";
import { TagsQueries } from "../../constants";
import { defaultTranslations } from "../i18n";
import type { TagPicker as TagPickerComponent } from "../tag-picker";

// tag-filter.test.tsx and tag-section.test.tsx register a process-wide
// mock.module stub on the resolved "../tag-picker" path; the query-string
// specifier loads the real component past it. It goes through a variable
// because tsc cannot resolve the suffixed specifier, so the namespace type
// comes from the type-only import above.
const REAL_TAG_PICKER_SPECIFIER = "../tag-picker?real=tag-picker-test";
const { TagPicker } = (await import(REAL_TAG_PICKER_SPECIFIER)) as {
  readonly TagPicker: typeof TagPickerComponent;
};

type TagRow = { id: string; name: string; color?: string; scope?: string; version: number };
type AssignmentRow = { tagId: string };

let catalogRows: readonly TagRow[] = [];
let assignmentRows: readonly AssignmentRow[] = [];

beforeEach(() => {
  catalogRows = [
    { id: "t1", name: "urgent", color: "#ef4444", version: 1 },
    { id: "t2", name: "later", version: 1 },
  ];
  assignmentRows = [];
  dispatchSpy.mockClear();
});

const dispatchSpy = mock(async () => ({ isSuccess: true, data: undefined }));

const useQuerySpy = mock((type: string) => {
  if (type === TagsQueries.tagList) {
    return {
      data: { rows: catalogRows },
      loading: false,
      error: null,
      refetch: mock(async () => {}),
    };
  }
  return {
    data: { rows: assignmentRows },
    loading: false,
    error: null,
    refetch: mock(async () => {}),
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

function Host({
  initialValue,
  initialOpen,
}: {
  readonly initialValue: readonly string[];
  readonly initialOpen: boolean;
}): ReactNode {
  const [open, setOpen] = useState(initialOpen);
  const [applied, setApplied] = useState<readonly string[]>(initialValue);
  const [bump, setBump] = useState(0);
  const value = applied.map((id) => id);
  return (
    <>
      <button type="button" data-testid="host-open" onClick={() => setOpen(true)}>
        open
      </button>
      <button type="button" data-testid="host-rerender" onClick={() => setBump(bump + 1)}>
        rerender {bump}
      </button>
      <span data-testid="host-applied">{value.join(",")}</span>
      <TagPicker
        entityType="note"
        value={value}
        onChange={setApplied}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}

describe("TagPicker — open/confirm/cancel sync", () => {
  test("confirm hands the toggled selection back to the caller", async () => {
    render(
      <Wrapper>
        <Host initialValue={[]} initialOpen={true} />
      </Wrapper>,
    );

    fireEvent.click(await screen.findByTestId("tag-manager-toggle-t1"));
    fireEvent.click(screen.getByTestId("tag-picker-dialog-confirm"));

    await waitFor(() => expect(screen.getByTestId("host-applied").textContent).toBe("t1"));
  });

  test("cancel discards the buffered selection; reopening starts from the caller's value", async () => {
    render(
      <Wrapper>
        <Host initialValue={["t1"]} initialOpen={true} />
      </Wrapper>,
    );

    fireEvent.click(await screen.findByTestId("tag-manager-toggle-t2"));
    fireEvent.click(screen.getByTestId("tag-picker-dialog-cancel"));

    await waitFor(() => expect(screen.queryByTestId("tag-picker-dialog")).toBeNull());
    expect(screen.getByTestId("host-applied").textContent).toBe("t1");

    fireEvent.click(screen.getByTestId("host-open"));
    fireEvent.click(await screen.findByTestId("tag-picker-dialog-confirm"));

    await waitFor(() => expect(screen.getByTestId("host-applied").textContent).toBe("t1"));
  });

  test("a parent re-render while open keeps the in-flight selection", async () => {
    render(
      <Wrapper>
        <Host initialValue={[]} initialOpen={true} />
      </Wrapper>,
    );

    fireEvent.click(await screen.findByTestId("tag-manager-toggle-t1"));
    expect(screen.getByTestId("tag-manager-toggle-t1").textContent).toBe("✓");

    fireEvent.click(screen.getByTestId("host-rerender"));
    await waitFor(() => expect(screen.getByTestId("tag-manager-toggle-t1").textContent).toBe("✓"));

    fireEvent.click(screen.getByTestId("tag-picker-dialog-confirm"));
    await waitFor(() => expect(screen.getByTestId("host-applied").textContent).toBe("t1"));
  });
});
