// A preview list column of type "file" shows the file behind a FileRef id as a download link.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ActionFormPreview } from "@cosmicdrift/kumiko-framework/ui-types";
import { waitFor } from "@testing-library/react";
import { DispatcherProvider } from "../../context/dispatcher-context.tsx";
import type { Dispatcher } from "../../headless/index.ts";
import { createMockDispatcher, render } from "../../web/__tests__/test-utils.tsx";
import { ActionFormPreviewPanel } from "../action-form-preview.tsx";

const FILE_ID = "bbbbbbbb-2222-4333-8444-666666666666";
const realFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        files: [{ id: FILE_ID, fileName: "invoice.pdf", mimeType: "application/pdf", size: 1 }],
      }),
      { status: 200 },
    )) as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const preview: ActionFormPreview = {
  query: "shop:query:draft",
  list: {
    field: "rows",
    columns: [
      { field: "name", label: "k.name" },
      { field: "document", label: "k.document", type: "file" },
    ],
  },
};

describe("ActionFormPreviewPanel file column", () => {
  test("a row with a fileRef id shows the file name as a download link", async () => {
    const dispatcher = createMockDispatcher({
      query: (async () => ({
        isSuccess: true,
        data: { rows: [{ name: "Row one", document: FILE_ID }] },
      })) as unknown as Dispatcher["query"],
    });
    const { findByText, container } = render(
      <DispatcherProvider dispatcher={dispatcher}>
        <ActionFormPreviewPanel
          preview={preview}
          fields={{}}
          values={{}}
          translate={(key) => key}
          locale="de-DE"
        />
      </DispatcherProvider>,
    );

    const link = await findByText("invoice.pdf");
    expect(link.closest("a")?.getAttribute("href")).toContain(`/api/files/${FILE_ID}`);
    await waitFor(() => expect(container.textContent).toContain("Row one"));
  });
});
