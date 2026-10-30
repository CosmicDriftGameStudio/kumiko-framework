import { afterEach, describe, expect, test } from "bun:test";
import {
  CONTENT_EDITOR_ELEMENT_ID,
  createStaticLocaleResolver,
  kumikoDefaultTranslations,
  LocaleProvider,
  PrimitivesProvider,
} from "@cosmicdrift/kumiko-renderer";
import { defaultPrimitives } from "@cosmicdrift/kumiko-renderer/web";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type ReactNode, useState } from "react";
import DocumentTiptapEditor from "../document-tiptap-editor.tsx";
import type { DocumentEditorHandle, DocumentEditorProps } from "../document-toolbar-blocks.ts";
import { defaultTranslations } from "../i18n.ts";
import PlaceholderLineEditor from "../placeholder-line-editor.tsx";

const localeResolver = createStaticLocaleResolver({ locale: "en" });

function Providers({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <LocaleProvider
      resolver={localeResolver}
      fallbackBundles={[kumikoDefaultTranslations, defaultTranslations]}
    >
      <PrimitivesProvider value={defaultPrimitives}>{children}</PrimitivesProvider>
    </LocaleProvider>
  );
}

type ExtraProps = Partial<
  Pick<
    DocumentEditorProps,
    | "variableLabels"
    | "systemVariables"
    | "resourcePreviews"
    | "chrome"
    | "toolbar"
    | "onEditorReady"
  >
>;

function Controlled({ initial = "", ...extra }: { readonly initial?: string } & ExtraProps) {
  const [value, setValue] = useState(initial);
  return (
    <Providers>
      <DocumentTiptapEditor
        id={CONTENT_EDITOR_ELEMENT_ID}
        value={value}
        onChange={setValue}
        variables={["invoice.number", "recipient.name"]}
        readOnly={false}
        {...extra}
      />
      <output data-testid="html">{value}</output>
    </Providers>
  );
}

function currentHtml(): string {
  return screen.getByTestId("html").textContent ?? "";
}

describe("DocumentTiptapEditor labels, handle and previews", () => {
  test("a labelled variable chip shows only the label, the name stays a tooltip", async () => {
    render(
      <Controlled
        initial='<p><span data-variable="invoice.number"></span></p>'
        variableLabels={{ "invoice.number": "Invoice number" }}
      />,
    );
    await screen.findByRole("button", { name: "Bold" });
    const chip = await screen.findByText("Invoice number");
    expect(chip.textContent).toBe("Invoice number");
    expect(chip.closest("[title]")?.getAttribute("title")).toBe("invoice.number");
  });

  test("the handle inserts a variable node and a resource", async () => {
    let handle: DocumentEditorHandle | null = null;
    render(
      <Controlled
        onEditorReady={(next) => {
          handle = next;
        }}
      />,
    );
    await screen.findByRole("button", { name: "Bold" });
    await waitFor(() => expect(handle).not.toBeNull());
    act(() => handle?.insertPlaceholder("recipient.name"));
    act(() => handle?.insertResource("logo", "Logo"));
    await waitFor(() => {
      expect(currentHtml()).toContain('<span data-variable="recipient.name"></span>');
      expect(currentHtml()).toContain('<img data-resource="logo" alt="Logo">');
    });
  });

  test("the handle ignores invalid names", async () => {
    let handle: DocumentEditorHandle | null = null;
    render(
      <Controlled
        onEditorReady={(next) => {
          handle = next;
        }}
      />,
    );
    await waitFor(() => expect(handle).not.toBeNull());
    act(() => handle?.insertPlaceholder("bad name"));
    act(() => handle?.insertResource("bad key!"));
    expect(currentHtml()).not.toContain("data-variable");
    expect(currentHtml()).not.toContain("data-resource");
  });

  test("a resource preview renders an image, never into the document", async () => {
    render(
      <Controlled
        initial='<img data-resource="logo">'
        resourcePreviews={{ logo: { src: "data:image/png;base64,AAAA", caption: "logo.png" } }}
      />,
    );
    await screen.findByRole("button", { name: "Bold" });
    const image = await waitFor(() => {
      const found = document.querySelector("img[src^='data:image/png']");
      if (found === null) throw new Error("no preview yet");
      return found;
    });
    expect(image.getAttribute("src")).toBe("data:image/png;base64,AAAA");
    expect(currentHtml()).not.toContain("data:image");
  });

  test("a preview with a scriptable scheme is not rendered", async () => {
    render(
      <Controlled
        initial='<img data-resource="logo">'
        resourcePreviews={{ logo: { src: "javascript:alert(1)" } }}
      />,
    );
    await screen.findByRole("button", { name: "Bold" });
    await screen.findByText("logo");
    expect(document.querySelector("img[src^='javascript']")).toBeNull();
  });

  test("canvas chrome labels blocks and offers underline and an HTML view", async () => {
    render(<Controlled chrome="canvas" initial='<img data-resource="logo">' />);
    await screen.findByRole("button", { name: "Underline" });
    await waitFor(() => {
      const label = document.querySelector(".ProseMirror span.uppercase");
      expect(label?.textContent).toBe("Image · inline");
    });
    fireEvent.click(screen.getByRole("button", { name: "Underline" }));
    fireEvent.keyDown(screen.getByRole("button", { name: "More" }), { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "HTML" }));
    const source = await screen.findByLabelText("HTML source");
    await waitFor(() =>
      expect(source.querySelector("pre")?.textContent).toContain('data-resource="logo"'),
    );
  });
});

function LineEditor({ initial }: { readonly initial: string }): ReactNode {
  const [value, setValue] = useState(initial);
  return (
    <Providers>
      <PlaceholderLineEditor
        id="subject"
        aria-label="Subject"
        value={value}
        onChange={setValue}
        variableLabels={{ invoiceNumber: "Invoice number" }}
        systemVariables={["tenantName"]}
      />
      <output data-testid="text">{value}</output>
    </Providers>
  );
}

describe("PlaceholderLineEditor", () => {
  test("renders placeholders as chips and keeps the plain text value", async () => {
    render(<LineEditor initial="Invoice {{invoiceNumber}} from {{tenantName}}" />);
    expect(await screen.findByText("Invoice number")).toBeTruthy();
    expect(screen.getByText("tenantName")).toBeTruthy();
    expect(screen.getByTestId("text").textContent).toBe(
      "Invoice {{invoiceNumber}} from {{tenantName}}",
    );
  });

  test("a late systemVariables change recolors the chips", async () => {
    const renderEditor = (systemVariables: readonly string[]) => (
      <Providers>
        <PlaceholderLineEditor
          id="subject"
          aria-label="Subject"
          value="Hi {{late}}"
          onChange={() => {}}
          systemVariables={systemVariables}
        />
      </Providers>
    );
    const { rerender } = render(renderEditor([]));
    const before = (await screen.findByText("late")).className;

    rerender(renderEditor(["late"]));

    await waitFor(() =>
      expect((screen.getByText("late") as HTMLElement).className).not.toBe(before),
    );
    expect((screen.getByText("late") as HTMLElement).className).toContain("bg-muted");
  });

  test("Enter does not add a line", async () => {
    render(<LineEditor initial="Hello" />);
    const box = await screen.findByRole("textbox", { name: "Subject" });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(box.querySelectorAll("p")).toHaveLength(1);
    expect(screen.getByTestId("text").textContent).toBe("Hello");
  });

  test("unknown-looking names stay plain text", async () => {
    render(<LineEditor initial="a {{bad name}} b" />);
    const box = await screen.findByRole("textbox", { name: "Subject" });
    expect(box.textContent).toContain("{{bad name}}");
  });

  test("compact toolbar renders icon-only buttons with a name and tooltip, full keeps the labels", async () => {
    const compact = render(<Controlled toolbar="compact" />);
    const table = await screen.findByRole("button", { name: "Table" });
    expect(table.getAttribute("title")).toBe("Table");
    expect(table.textContent).toBe("");
    const placeholder = screen.getByRole("button", { name: "Placeholder" });
    expect(placeholder.getAttribute("title")).toBe("Placeholder");
    expect(placeholder.textContent).toBe("");
    expect(screen.getByRole("button", { name: "Bold" }).getAttribute("title")).toBe("Bold");
    compact.unmount();

    render(<Controlled />);
    const fullTable = await screen.findByRole("button", { name: "Table" });
    expect(fullTable.textContent).toBe("Table");
  });
});

function ExternalValue({
  onChangeSpy,
  onEditorReady,
}: {
  readonly onChangeSpy: (html: string) => void;
  readonly onEditorReady?: ExtraProps["onEditorReady"];
}) {
  const [value, setValue] = useState("");
  return (
    <Providers>
      <DocumentTiptapEditor
        id={CONTENT_EDITOR_ELEMENT_ID}
        value={value}
        onChange={(html) => {
          onChangeSpy(html);
          setValue(html);
        }}
        variables={[]}
        readOnly={false}
        {...(onEditorReady && { onEditorReady })}
      />
      <button type="button" onClick={() => setValue("<p>loaded <strong>body</strong></p>")}>
        load canonical
      </button>
      <button type="button" onClick={() => setValue("<b>loaded</b>")}>
        load non-canonical
      </button>
      <output data-testid="html">{value}</output>
    </Providers>
  );
}

describe("DocumentTiptapEditor value sync", () => {
  test("mounting with an empty value emits no onChange", async () => {
    const changes: string[] = [];
    render(<ExternalValue onChangeSpy={(html) => changes.push(html)} />);
    await screen.findByRole("button", { name: "Bold" });
    await waitFor(() => expect(document.querySelector(".ProseMirror")).not.toBeNull());
    await act(async () => {});
    expect(changes).toEqual([]);
  });

  test("a body that arrives after mount is shown without emitting onChange", async () => {
    const changes: string[] = [];
    render(<ExternalValue onChangeSpy={(html) => changes.push(html)} />);
    await screen.findByRole("button", { name: "Bold" });
    await waitFor(() => expect(document.querySelector(".ProseMirror")).not.toBeNull());
    changes.length = 0;

    fireEvent.click(screen.getByRole("button", { name: "load canonical" }));

    await waitFor(() => {
      expect(document.querySelector(".ProseMirror")?.innerHTML).toContain("<strong>body</strong>");
    });
    expect(changes).toEqual([]);
  });

  test("a non-canonical body is normalised once without a update loop, and the next edit emits the canonical html", async () => {
    const changes: string[] = [];
    let handle: DocumentEditorHandle | null = null;
    render(
      <ExternalValue
        onChangeSpy={(html) => changes.push(html)}
        onEditorReady={(next) => {
          handle = next;
        }}
      />,
    );
    await screen.findByRole("button", { name: "Bold" });
    await waitFor(() => expect(handle).not.toBeNull());
    await waitFor(() => expect(document.querySelector(".ProseMirror")).not.toBeNull());
    changes.length = 0;

    fireEvent.click(screen.getByRole("button", { name: "load non-canonical" }));
    await waitFor(() => {
      expect(document.querySelector(".ProseMirror")?.innerHTML).toContain(
        "<strong>loaded</strong>",
      );
    });
    // setContent decides emitUpdate synchronously, so the rendered content
    // already proves no onChange was emitted for the load.
    expect(changes).toEqual([]);

    act(() => handle?.insertPlaceholder("name"));
    await waitFor(() => expect(changes).toHaveLength(1));
    const [emitted = ""] = changes;
    await waitFor(() => expect(currentHtml()).toBe(emitted));
    // The echoed value re-enters the editor; a loop would emit again in that commit.
    await act(async () => {});
    expect(changes).toHaveLength(1);
    expect(emitted).toContain("<strong>loaded</strong>");
    expect(emitted).toContain('<span data-variable="name"></span>');
    expect(currentHtml()).toBe(emitted);
  });
});

describe("onEditorReady lifecycle", () => {
  test("DocumentTiptapEditor reports its handle, then null when it unmounts", async () => {
    const reports: Array<DocumentEditorHandle | null> = [];
    const view = render(
      <Providers>
        <DocumentTiptapEditor
          id={CONTENT_EDITOR_ELEMENT_ID}
          value=""
          onChange={() => {}}
          variables={[]}
          readOnly={false}
          onEditorReady={(next) => reports.push(next)}
        />
      </Providers>,
    );
    await waitFor(() => expect(reports.at(-1)).not.toBeNull());
    view.unmount();
    await waitFor(() => expect(reports.at(-1)).toBeNull());
  });

  test("PlaceholderLineEditor swallows the replaced editor's null, reports the new handle, and reports null on unmount", async () => {
    const reports: Array<DocumentEditorHandle | null> = [];
    const onEditorReady = (next: DocumentEditorHandle | null): void => {
      reports.push(next);
    };
    const line = (value: string) => (
      <PlaceholderLineEditor
        id="line"
        aria-label="Line"
        value={value}
        onChange={() => {}}
        onEditorReady={onEditorReady}
      />
    );
    const view = render(line("first"));
    await waitFor(() => expect(reports.at(-1)).not.toBeNull());

    view.rerender(line("loaded later"));
    view.unmount();
    await waitFor(() => expect(reports.at(-1)).toBeNull());
    await act(async () => {});
    expect(reports.map((report) => report === null)).toEqual([false, false, true]);
  });

  describe("with browser timer order", () => {
    const realSetTimeout = globalThis.setTimeout;
    afterEach(() => {
      globalThis.setTimeout = realSetTimeout;
    });

    // Chrome can fire TipTap's 0 ms create before the 1 ms deferred destroy scheduled earlier;
    // delaying 1 ms timers forces that order regardless of the runtime's clamping.
    function fireCreateBeforeDeferredDestroy(): void {
      globalThis.setTimeout = ((handler: TimerHandler, ms?: number, ...args: unknown[]) =>
        realSetTimeout(handler, ms === 1 ? 30 : ms, ...args)) as typeof setTimeout;
    }

    test("keeps the new handle when a remount's old editor is destroyed late", async () => {
      fireCreateBeforeDeferredDestroy();
      const reports: Array<DocumentEditorHandle | null> = [];
      const changes: string[] = [];
      const line = (labels: Record<string, string>) => (
        <PlaceholderLineEditor
          id="line"
          aria-label="Line"
          value="Hello"
          onChange={(next) => changes.push(next)}
          variableLabels={labels}
          onEditorReady={(next) => reports.push(next)}
        />
      );
      const view = render(line({}));
      await waitFor(() => expect(reports.at(-1)).not.toBeNull());

      view.rerender(line({ name: "Name" }));
      await waitFor(() => expect(reports.filter((report) => report !== null)).toHaveLength(2));
      await new Promise((resolve) => realSetTimeout(resolve, 80));

      const live = reports.at(-1);
      expect(live).not.toBeNull();
      act(() => live?.insertPlaceholder("name"));
      await waitFor(() => expect(changes.at(-1)).toContain("{{name}}"));
    });
  });
});
