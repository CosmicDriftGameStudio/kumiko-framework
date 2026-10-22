import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type {
  EntityDefinition,
  EntityEditScreenDefinition,
  ProjectionDetailScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { act, fireEvent, waitFor } from "@testing-library/react";
import { DispatcherProvider, type FeatureSchema, KumikoScreen } from "../../index.ts";
import { FileValueList } from "../primitives/file-value-list.tsx";
import { createMockDispatcher, render } from "./test-utils.tsx";

const PDF_ID = "11111111-2222-4333-8444-555555555555";
const PNG_ID = "66666666-7777-4888-8999-000000000000";
const realFetch = globalThis.fetch;

const METAS: Record<string, { fileName: string; mimeType: string }> = {
  [PDF_ID]: { fileName: "Rechnung-Oktober.pdf", mimeType: "application/pdf" },
  [PNG_ID]: { fileName: "Beleg-Foto.png", mimeType: "image/png" },
};

beforeEach(() => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (!url.startsWith("/api/files/meta?ids=")) return new Response("not found", { status: 404 });
    const files = Object.entries(METAS)
      .filter(([id]) => url.includes(id))
      .map(([id, meta]) => ({ id, ...meta, size: 1 }));
    return new Response(JSON.stringify({ files }), { status: 200 });
  }) as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("FileValueList", () => {
  test("lists name and download link per file, and a preview toggle only for the PDF", async () => {
    const { findByText, getByTestId, queryByTestId } = render(
      <FileValueList fileIds={[PDF_ID, PNG_ID]} testId="files" />,
    );
    await findByText("Beleg-Foto.png");
    await findByText("Rechnung-Oktober.pdf");
    expect(getByTestId(`files-${PDF_ID}-download`).getAttribute("href")).toBe(
      `/api/files/${PDF_ID}`,
    );
    expect(getByTestId(`files-${PNG_ID}-download`).getAttribute("href")).toBe(
      `/api/files/${PNG_ID}`,
    );
    expect(getByTestId(`files-${PDF_ID}-preview-toggle`)).toBeDefined();
    expect(queryByTestId(`files-${PNG_ID}-preview-toggle`)).toBeNull();
  });

  test("the toggle mounts and hides the PDF preview container", async () => {
    const { findByTestId, getByTestId, queryByTestId } = render(
      <FileValueList fileIds={[PDF_ID]} testId="files" />,
    );
    const toggle = await findByTestId(`files-${PDF_ID}-preview-toggle`);
    expect(queryByTestId(`file-preview-${PDF_ID}`)).toBeNull();
    await act(async () => {
      fireEvent.click(toggle);
    });
    expect(getByTestId(`file-preview-${PDF_ID}`)).toBeDefined();
    await act(async () => {
      fireEvent.click(toggle);
    });
    await waitFor(() => expect(queryByTestId(`file-preview-${PDF_ID}`)).toBeNull());
  });

  test("previewOpenByDefault opens the first file's preview on render, not the others", async () => {
    const { findByTestId, queryByTestId } = render(
      <FileValueList fileIds={[PDF_ID, PNG_ID]} previewOpenByDefault testId="files" />,
    );
    await findByTestId(`file-preview-${PDF_ID}`);
    expect(queryByTestId(`file-preview-${PNG_ID}`)).toBeNull();
  });

  test("without previewOpenByDefault the preview starts closed", async () => {
    const { findByTestId, queryByTestId } = render(
      <FileValueList fileIds={[PDF_ID]} testId="files" />,
    );
    await findByTestId(`files-${PDF_ID}-preview-toggle`);
    expect(queryByTestId(`file-preview-${PDF_ID}`)).toBeNull();
  });

  test("a non-uuid id is plain text and triggers no request", () => {
    let requests = 0;
    globalThis.fetch = (async () => {
      requests += 1;
      return new Response("{}");
    }) as unknown as typeof fetch;
    const { getByText, container } = render(<FileValueList fileIds={["../x"]} />);
    expect(getByText("../x")).toBeDefined();
    expect(container.querySelector("a")).toBeNull();
    expect(requests).toBe(0);
  });
});

describe("renderer format file on read-only fields", () => {
  test("a projectionDetail layout field shows the file list instead of the raw ids", async () => {
    const screenDef = {
      id: "expose-detail",
      type: "projectionDetail",
      query: "demo:query:expose",
      singleton: true,
      layout: {
        sections: [
          { title: "Unterlagen", fields: [{ field: "exposeFiles", renderer: { format: "file" } }] },
        ],
      },
    } as ProjectionDetailScreenDefinition;
    const schema: FeatureSchema = {
      featureName: "demo",
      entities: {},
      screens: [screenDef as FeatureSchema["screens"][number]],
    };
    const dispatcher = createMockDispatcher({
      query: (async () => ({
        isSuccess: true,
        data: { id: "e1", exposeFiles: [PDF_ID, PNG_ID] },
      })) as never,
    });
    const { findByText, getByTestId, queryByText } = render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen schema={schema} qn="demo:screen:expose-detail" />
      </DispatcherProvider>,
    );
    await findByText("Rechnung-Oktober.pdf");
    expect(getByTestId(`field-value-exposeFiles-${PDF_ID}-download`)).toBeDefined();
    expect(queryByText(PDF_ID)).toBeNull();
  });

  test("a readOnly entityEdit field behaves the same", async () => {
    const entity = {
      fields: { docs: { type: "text", required: false } },
    } as unknown as EntityDefinition;
    const screenDef: EntityEditScreenDefinition = {
      id: "thing-edit",
      type: "entityEdit",
      entity: "thing",
      layout: {
        sections: [{ fields: [{ field: "docs", readOnly: true, renderer: { format: "file" } }] }],
      },
    };
    const schema: FeatureSchema = {
      featureName: "demo",
      entities: { thing: entity },
      screens: [screenDef],
    };
    const dispatcher = createMockDispatcher({
      query: (async () => ({ isSuccess: true, data: { id: "t1", docs: PNG_ID } })) as never,
    });
    const { findByText, getByTestId, queryByText } = render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen schema={schema} qn="demo:screen:thing-edit" entityId="t1" />
      </DispatcherProvider>,
    );
    await findByText("Beleg-Foto.png");
    expect(getByTestId(`field-value-docs-${PNG_ID}-download`)).toBeDefined();
    expect(queryByText(PNG_ID)).toBeNull();
  });
});
