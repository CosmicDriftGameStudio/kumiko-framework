import { describe, expect, test } from "bun:test";
import { act, cleanup, render, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { DispatcherProvider } from "../../context/dispatcher-context.tsx";
import { createLiveDispatcher } from "../../live/index.ts";
import { useQuery } from "../use-query.ts";

type PendingCall = {
  readonly path: string;
  readonly init: RequestInit;
  readonly respond: (body: unknown) => void;
};

function deferredFetch(): { fetch: typeof fetch; calls: PendingCall[] } {
  const calls: PendingCall[] = [];
  const fakeFetch = (input: string | URL | Request, init?: RequestInit): Promise<Response> =>
    new Promise<Response>((resolve, reject) => {
      const requestInit = init ?? {};
      calls.push({
        path: String(input),
        init: requestInit,
        respond: (body) =>
          resolve(
            new Response(JSON.stringify(body), {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
          ),
      });
      requestInit.signal?.addEventListener("abort", () =>
        reject(new DOMException("aborted", "AbortError")),
      );
    });
  return { fetch: fakeFetch as typeof fetch, calls };
}

const QUERY_TYPE = "f:query:x:list";
const ANSWER = { data: { rows: [1] } };

function setup() {
  const fake = deferredFetch();
  const dispatcher = createLiveDispatcher({ fetch: fake.fetch, readCsrf: () => undefined });
  const wrapper = ({ children }: { readonly children: ReactNode }) => (
    <DispatcherProvider dispatcher={dispatcher}>{children}</DispatcherProvider>
  );
  return { calls: fake.calls, wrapper };
}

function Reader({ testId }: { readonly testId: string }): ReactNode {
  const { data } = useQuery<{ rows: number[] }>(QUERY_TYPE, { a: 1 });
  return <output data-testid={testId}>{data === null ? "" : data.rows.join(",")}</output>;
}

describe("useQuery shared in-flight request", () => {
  test("two hooks with the same type and payload send one request", async () => {
    const { calls, wrapper } = setup();
    const { result } = renderHook(
      () => ({
        first: useQuery<{ rows: number[] }>(QUERY_TYPE, { a: 1 }),
        second: useQuery<{ rows: number[] }>(QUERY_TYPE, { a: 1 }),
      }),
      { wrapper },
    );
    await act(async () => {});
    expect(calls).toHaveLength(1);
    await act(async () => {
      calls[0]?.respond(ANSWER);
    });
    expect(result.current.first.data).toEqual({ rows: [1] });
    expect(result.current.second.data).toEqual({ rows: [1] });
  });

  test("refetch() while the first request is open sends a second request", async () => {
    const { calls, wrapper } = setup();
    const { result } = renderHook(
      () => ({
        first: useQuery<{ rows: number[] }>(QUERY_TYPE, { a: 1 }),
        second: useQuery<{ rows: number[] }>(QUERY_TYPE, { a: 1 }),
      }),
      { wrapper },
    );
    await act(async () => {});
    expect(calls).toHaveLength(1);
    await act(async () => {
      void result.current.first.refetch();
    });
    expect(calls).toHaveLength(2);
  });

  test("unmounting one of two hooks keeps the request alive for the other", async () => {
    const { calls, wrapper: Wrapper } = setup();
    const tree = (both: boolean) => (
      <Wrapper>
        <Reader testId="a" />
        {both ? <Reader testId="b" /> : null}
      </Wrapper>
    );
    const view = render(tree(true));
    await act(async () => {});
    expect(calls).toHaveLength(1);
    view.rerender(tree(false));
    await act(async () => {});
    expect(calls[0]?.init.signal?.aborted).toBe(false);
    await act(async () => {
      calls[0]?.respond(ANSWER);
    });
    expect(view.getByTestId("a").textContent).toBe("1");
    cleanup();
  });
});
