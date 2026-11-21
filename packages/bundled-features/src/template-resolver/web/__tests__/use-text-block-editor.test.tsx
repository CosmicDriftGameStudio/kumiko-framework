import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { TargetRef } from "@cosmicdrift/kumiko-framework/engine";
import { mockModuleForFile } from "@cosmicdrift/kumiko-testing/helpers/mock-module";
import { act, renderHook } from "@testing-library/react";

type LoadedBlock = {
  readonly slug: string;
  readonly locale: string;
  readonly title: string | null;
  readonly content: string | null;
  readonly contentFormat: string;
  readonly folder: string | null;
  readonly modifiedAt: string | null;
};

function block(title: string, content: string): LoadedBlock {
  return {
    slug: "welcome",
    locale: "de",
    title,
    content,
    contentFormat: "plain",
    folder: null,
    modifiedAt: null,
  };
}

function NoContentEditor(): null {
  return null;
}

let queryResult: { data: LoadedBlock | null; loading: boolean; error: string | null };
const dispatcherWrite = mock(async () => {
  throw new Error("network down");
});

mockModuleForFile("@cosmicdrift/kumiko-renderer", await import("@cosmicdrift/kumiko-renderer"), {
  useQuery: () => queryResult,
  useTranslation: () => (key: string) => key,
  useDispatcher: () => ({ write: dispatcherWrite }),
});

mockModuleForFile(
  new URL("../use-collection-editor-context.ts", import.meta.url).pathname,
  await import("../use-collection-editor-context.ts"),
  {
    useCollectionEditorContext: () => ({
      collection: undefined,
      contentFormat: "plain",
      ContentEditor: NoContentEditor,
      documentBlocks: [],
      variableExamples: {},
      variables: [],
      canWrite: true,
    }),
  },
);

const { useTextBlockEditor } = await import("../use-text-block-editor.ts");

const TARGET: TargetRef = {
  featureId: "template-resolver",
  action: "edit",
  args: { slug: "welcome", locale: "de" },
};

describe("useTextBlockEditor", () => {
  beforeEach(() => {
    queryResult = { data: block("Willkommen", "Hallo"), loading: false, error: null };
    dispatcherWrite.mockClear();
  });

  test("shows the loaded title and content, not dirty", () => {
    const { result } = renderHook(() => useTextBlockEditor(TARGET));
    expect(result.current.title).toBe("Willkommen");
    expect(result.current.content).toBe("Hallo");
    expect(result.current.dirty).toBe(false);
  });

  test("typing makes the editor dirty and discard restores the loaded values", () => {
    const { result } = renderHook(() => useTextBlockEditor(TARGET));
    act(() => result.current.setTitle("Neu"));
    act(() => result.current.setContent("Anderer Text"));
    expect(result.current.dirty).toBe(true);

    act(() => result.current.discard());
    expect(result.current.title).toBe("Willkommen");
    expect(result.current.content).toBe("Hallo");
    expect(result.current.dirty).toBe(false);
  });

  test("a refetch with the same values keeps what the user typed", () => {
    const { result, rerender } = renderHook(() => useTextBlockEditor(TARGET));
    act(() => result.current.setTitle("Neu"));

    queryResult = { data: block("Willkommen", "Hallo"), loading: false, error: null };
    rerender();

    expect(result.current.title).toBe("Neu");
    expect(result.current.dirty).toBe(true);
  });

  test("a refetch with other values resets the form and clears the save error", async () => {
    const { result, rerender } = renderHook(() => useTextBlockEditor(TARGET));
    act(() => result.current.setTitle("Neu"));
    await act(async () => {
      await result.current.save();
    });
    expect(result.current.saveError).toBe("network down");

    queryResult = { data: block("Willkommen", "Geändert"), loading: false, error: null };
    rerender();

    expect(result.current.title).toBe("Willkommen");
    expect(result.current.content).toBe("Geändert");
    expect(result.current.dirty).toBe(false);
    expect(result.current.saveError).toBeNull();
  });
});
