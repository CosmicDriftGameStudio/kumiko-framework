import { describe, expect, test } from "bun:test";
import { act, render } from "@testing-library/react";
import { DispatcherProvider } from "../../context/dispatcher-context.tsx";
import type { Dispatcher } from "../../headless/index.ts";
import type { ListGroupPageResult } from "../../hooks/list-group-pages.ts";
import { ListGroupPageBridges } from "../list-group-page-bridges.tsx";

type QueryFn = Dispatcher["query"];

function dispatcherAnsweringOnly(answered: string): Dispatcher {
  const query = (async (_type: string, payload: { readonly filter: string }) => {
    if (payload.filter !== answered) return new Promise(() => {});
    return {
      isSuccess: true,
      data: { rows: [{ id: answered }], nextCursor: `cursor-${answered}` },
    };
  }) as unknown as QueryFn;
  return {
    write: (async () => ({ isSuccess: true, data: {} })) as unknown as Dispatcher["write"],
    query,
    batch: (async () => ({ isSuccess: true, results: [] })) as unknown as Dispatcher["batch"],
    statusStore: {
      getState: () => "online",
      subscribe: () => () => {},
    } as unknown as Dispatcher["statusStore"],
    async *stream() {},
    pendingWrites: () => [],
    pendingFiles: () => [],
  };
}

describe("ListGroupPageBridges", () => {
  test("after a reset the previous filter's rows are not reported for the same page", async () => {
    const reported: { resetKey: string; result: ListGroupPageResult }[] = [];
    const bridges = (resetKey: string, filter: string) => (
      <DispatcherProvider dispatcher={dispatcherAnsweringOnly("old")}>
        <ListGroupPageBridges
          queryType="f:query:x:list"
          requests={[{ pageKey: "open#0", payload: { filter } }]}
          onResult={(_pageKey, result) => reported.push({ resetKey, result })}
          refreshNonce={0}
          resetKey={resetKey}
        />
      </DispatcherProvider>
    );

    const view = render(bridges("old", "old"));
    await act(async () => {});
    expect(reported.some((entry) => entry.resetKey === "old")).toBe(true);

    await act(async () => {
      view.rerender(bridges("new", "new"));
    });

    expect(reported.filter((entry) => entry.resetKey === "new")).toEqual([]);
  });
});
