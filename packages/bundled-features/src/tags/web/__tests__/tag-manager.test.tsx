import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  createStaticLocaleResolver,
  LocaleProvider,
  PrimitivesProvider,
} from "@cosmicdrift/kumiko-renderer";
import { defaultPrimitives } from "@cosmicdrift/kumiko-renderer-web";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { defaultTranslations } from "../i18n";
import { TagManager } from "../tag-manager";

type TagRow = { id: string; name: string; color?: string; scope?: string; version: number };

let catalogRows: readonly TagRow[] = [];

beforeEach(() => {
  catalogRows = [{ id: "t1", name: "urgent", color: "#ef4444", version: 1 }];
});

const dispatchSpy = mock(async () => ({ isSuccess: true, data: undefined }));

const actual_renderer = await import("@cosmicdrift/kumiko-renderer");
mock.module("@cosmicdrift/kumiko-renderer", () => ({
  ...actual_renderer,
  useDispatcher: mock(() => ({ write: dispatchSpy, query: mock(), batch: mock() })),
  useQuery: mock(() => ({
    data: { rows: catalogRows },
    loading: false,
    error: null,
    refetch: mock(),
  })),
}));

function Wrapper({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <LocaleProvider resolver={createStaticLocaleResolver()} fallbackBundles={[defaultTranslations]}>
      <PrimitivesProvider value={defaultPrimitives}>{children}</PrimitivesProvider>
    </LocaleProvider>
  );
}

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
