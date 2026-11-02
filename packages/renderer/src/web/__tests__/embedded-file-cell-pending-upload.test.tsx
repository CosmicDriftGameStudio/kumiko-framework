import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { fireEvent, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import {
  FormUploadTrackerProvider,
  useFormPendingUploadsHost,
} from "../../components/form-pending-uploads.tsx";
import type { EmbeddedListColumn } from "../../index.ts";
import { EmbeddedFileCell } from "../primitives/embedded-file-cell.tsx";
import { render, screen } from "./test-utils.tsx";

const column = { field: "receipt", type: "files" } as unknown as EmbeddedListColumn;

let resolveUpload: (id: string) => void;
let changes: unknown[];

beforeEach(() => {
  changes = [];
  spyOn(globalThis, "fetch").mockImplementation(
    (() =>
      new Promise<Response>((resolve) => {
        resolveUpload = (id) => resolve(new Response(JSON.stringify({ id }), { status: 201 }));
      })) as unknown as typeof fetch,
  );
});

afterEach(() => {
  (globalThis.fetch as unknown as { mockRestore(): void }).mockRestore();
});

function Host(): ReactNode {
  const host = useFormPendingUploadsHost();
  return (
    <FormUploadTrackerProvider value={host.trackUpload}>
      <span data-testid="pending">{host.pendingUploads}</span>
      <EmbeddedFileCell
        cellId="row-0-receipt"
        label="Receipt"
        column={column}
        value={[]}
        readOnly={false}
        uploadTarget={{ entityType: "claim", fieldName: "rows" }}
        onChange={(value) => changes.push(value)}
      />
    </FormUploadTrackerProvider>
  );
}

describe("EmbeddedFileCell inside a form", () => {
  test("registers its running upload with the form until the id is lifted", async () => {
    const { container } = render(<Host />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, "files", {
      value: [new File(["%PDF"], "a.pdf", { type: "application/pdf" })],
      configurable: true,
    });
    fireEvent.change(input);

    await waitFor(() => expect(screen.getByTestId("pending").textContent).toBe("1"));
    expect(changes).toEqual([]);

    resolveUpload("file-9");
    await waitFor(() => expect(screen.getByTestId("pending").textContent).toBe("0"));
    expect(changes).toEqual([["file-9"]]);
  });
});
