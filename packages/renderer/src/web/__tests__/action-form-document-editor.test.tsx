import { describe, expect, test } from "bun:test";
import type { ActionFormScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher } from "../../headless/index.ts";
import {
  type ContentEditorProps,
  ContentEditorsProvider,
  DispatcherProvider,
  KumikoScreen,
  NavProvider,
} from "../../index.ts";
import { createMockDispatcher, fireEvent, render, screen, waitFor } from "./test-utils.tsx";

const form: ActionFormScreenDefinition = {
  id: "new-message",
  type: "actionForm",
  handler: "mail:write:send",
  fields: {
    recipient: { type: "text", required: true },
    body: { type: "longText" },
  },
  layout: {
    sections: [
      { id: "recipients", title: "Recipients", fields: ["recipient"] },
      { id: "message", title: "Message", fields: [{ field: "body", editor: "document" }] },
    ],
  },
  preview: {
    query: "mail:query:preview",
    section: "recipients",
    facts: [{ field: "count", label: "Recipients" }],
  },
};

const memoryNav = {
  route: { screenId: "new-message" },
  navigate: () => {},
  replace: () => {},
  hrefFor: () => "",
  searchParams: {},
  setSearchParams: () => {},
};

function FakeDocumentEditor({ id, value, onChange }: ContentEditorProps) {
  return (
    <div data-testid="fake-document-editor" id={id}>
      <button type="button" onClick={() => onChange(`${value}<p>x</p>`)}>
        edit
      </button>
    </div>
  );
}

const seen: string[] = [];

function RecordingEditor({ value }: ContentEditorProps) {
  seen.push(value);
  return <div data-testid="fake-document-editor" />;
}

function renderForm(
  screenDefinition: ActionFormScreenDefinition,
  editors: { readonly document?: typeof FakeDocumentEditor } = {},
) {
  const dispatcher = createMockDispatcher({
    query: (async () => ({
      isSuccess: true,
      data: { count: 3 },
    })) as unknown as Dispatcher["query"],
  });
  return render(
    <DispatcherProvider dispatcher={dispatcher}>
      <NavProvider value={memoryNav}>
        <ContentEditorsProvider value={editors}>
          <KumikoScreen
            schema={{ featureName: "mail", entities: {}, screens: [screenDefinition] }}
            qn="mail:screen:new-message"
          />
        </ContentEditorsProvider>
      </NavProvider>
    </DispatcherProvider>,
  );
}

describe("actionForm field editor document", () => {
  test("renders the registered document editor instead of a textarea", () => {
    renderForm(form, { document: FakeDocumentEditor });
    expect(screen.getByTestId("fake-document-editor")).toBeTruthy();
    expect(document.querySelector("textarea")).toBeNull();
  });

  test("falls back to the textarea without a registered editor", () => {
    renderForm(form);
    expect(screen.queryByTestId("fake-document-editor")).toBeNull();
    expect(document.querySelector("textarea")).not.toBeNull();
  });
});

describe("actionForm preview section", () => {
  test("renders at the end of the named section, not below the form", async () => {
    renderForm(form);
    fireEvent.change(document.querySelector("#kumiko-edit-recipient") as HTMLInputElement, {
      target: { value: "a@example.com" },
    });
    const preview = await waitFor(() => screen.getByTestId("action-form-preview"));
    const messageHeading = screen.getByText("Message");
    expect(
      preview.compareDocumentPosition(messageHeading) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("a preview without title renders no title row", async () => {
    renderForm(form);
    fireEvent.change(document.querySelector("#kumiko-edit-recipient") as HTMLInputElement, {
      target: { value: "a@example.com" },
    });
    const preview = await waitFor(() => screen.getByTestId("action-form-preview"));
    expect(preview.querySelector("h1, h2, h3, h4, [data-banner-title]")).toBeNull();
  });
});

describe("document field with aiAssist", () => {
  test("shows the assist chips and writes the result as html paragraphs into the editor", async () => {
    seen.length = 0;
    const dispatcher = createMockDispatcher({
      query: (async () => ({
        isSuccess: true,
        data: { message: "Dear <you>,\n\nsecond\nline" },
      })) as unknown as Dispatcher["query"],
    });
    const assistForm: ActionFormScreenDefinition = {
      ...form,
      preview: undefined as never,
      layout: {
        sections: [
          {
            id: "message",
            fields: [
              {
                field: "body",
                editor: "document",
                aiAssist: {
                  query: "mail:query:draft",
                  resultField: "message",
                  chips: [{ label: "Shorter", params: { style: "short" } }],
                },
              },
            ],
          },
        ],
      },
    };
    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <NavProvider value={memoryNav}>
          <ContentEditorsProvider value={{ document: RecordingEditor }}>
            <KumikoScreen
              schema={{ featureName: "mail", entities: {}, screens: [assistForm] }}
              qn="mail:screen:new-message"
            />
          </ContentEditorsProvider>
        </NavProvider>
      </DispatcherProvider>,
    );

    expect(screen.getByTestId("fake-document-editor")).toBeTruthy();
    fireEvent.click(screen.getByTestId("field-ai-chip-body-0"));
    await waitFor(() => expect(seen.at(-1)).toBe("<p>Dear &lt;you&gt;,</p><p>second<br>line</p>"));
  });
});

describe("actionForm field width in a columns section", () => {
  const widthForm = (columns?: number): ActionFormScreenDefinition => ({
    id: "new-message",
    type: "actionForm",
    handler: "mail:write:send",
    fields: { subject: { type: "text" } },
    layout: { sections: [{ ...(columns !== undefined && { columns }), fields: ["subject"] }] },
  });

  function cellClass(): string {
    const input = document.querySelector("#kumiko-edit-subject") as HTMLElement;
    return input.closest("div.max-w-full")?.className ?? "";
  }

  test("a declared two-column section lets the field fill its cell", () => {
    renderForm(widthForm(2));
    expect(cellClass()).not.toContain("sm:w-60");
  });

  test("without columns the field keeps its type width", () => {
    renderForm(widthForm());
    expect(cellClass()).toContain("sm:w-60");
  });
});
