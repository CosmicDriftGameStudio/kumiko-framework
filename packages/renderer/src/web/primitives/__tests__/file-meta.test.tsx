import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { type FileMeta, useFileMeta } from "../../index.ts";
import { clearFileMetaCache } from "../file-thumbnail.tsx";

const ids = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
];

function MetaCell({ fileId }: { readonly fileId: string }): ReactNode {
  const meta: FileMeta | null = useFileMeta(fileId);
  return <span data-testid={`cell-${fileId}`}>{meta?.mimeType ?? "pending"}</span>;
}

const realFetch = globalThis.fetch;
let requestedUrls: string[] = [];

beforeEach(() => {
  clearFileMetaCache();
  requestedUrls = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    requestedUrls.push(url);
    const files = ids.map((id, index) => ({
      id,
      fileName: `file-${index}`,
      mimeType: index === 0 ? "application/pdf" : "image/png",
    }));
    return new Response(JSON.stringify({ files }), { status: 200 });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("useFileMeta", () => {
  test("cells with different ids in one render share a single meta request", async () => {
    render(
      <>
        {ids.map((id) => (
          <MetaCell key={id} fileId={id} />
        ))}
      </>,
    );

    await waitFor(() =>
      expect(screen.getByTestId(`cell-${ids[0]}`).textContent).toBe("application/pdf"),
    );
    expect(screen.getByTestId(`cell-${ids[1]}`).textContent).toBe("image/png");
    expect(requestedUrls).toHaveLength(1);
    for (const id of ids) expect(requestedUrls[0]).toContain(id);
  });
});
