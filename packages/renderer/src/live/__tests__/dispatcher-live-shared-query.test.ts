import { describe, expect, test } from "bun:test";
import { createLiveDispatcher } from "../dispatcher-live.ts";

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
  return { dispatcher, calls: fake.calls };
}

describe("createLiveDispatcher shareInFlight", () => {
  test("two identical shared queries send one request and both get the data", async () => {
    const { dispatcher, calls } = setup();
    const first = dispatcher.query(QUERY_TYPE, { a: 1 }, { shareInFlight: true });
    const second = dispatcher.query(QUERY_TYPE, { a: 1 }, { shareInFlight: true });
    expect(calls).toHaveLength(1);
    calls[0]?.respond(ANSWER);
    const [one, two] = await Promise.all([first, second]);
    expect(one).toEqual({ isSuccess: true, data: { rows: [1] } });
    expect(two).toEqual({ isSuccess: true, data: { rows: [1] } });
  });

  test("a query without shareInFlight sends its own request", async () => {
    const { dispatcher, calls } = setup();
    const shared = dispatcher.query(QUERY_TYPE, { a: 1 }, { shareInFlight: true });
    const plain = dispatcher.query(QUERY_TYPE, { a: 1 });
    expect(calls).toHaveLength(2);
    for (const call of calls) call.respond(ANSWER);
    await Promise.all([shared, plain]);
  });

  test("a different payload sends its own request", async () => {
    const { dispatcher, calls } = setup();
    const first = dispatcher.query(QUERY_TYPE, { a: 1 }, { shareInFlight: true });
    const second = dispatcher.query(QUERY_TYPE, { a: 2 }, { shareInFlight: true });
    expect(calls).toHaveLength(2);
    for (const call of calls) call.respond(ANSWER);
    await Promise.all([first, second]);
  });

  test("one participant aborting leaves the request running for the other", async () => {
    const { dispatcher, calls } = setup();
    const firstCtrl = new AbortController();
    const secondCtrl = new AbortController();
    const first = dispatcher.query(QUERY_TYPE, { a: 1 }, {
      shareInFlight: true,
      signal: firstCtrl.signal,
    });
    const second = dispatcher.query(QUERY_TYPE, { a: 1 }, {
      shareInFlight: true,
      signal: secondCtrl.signal,
    });
    firstCtrl.abort();
    const aborted = await first;
    expect(aborted.isSuccess).toBe(false);
    if (!aborted.isSuccess) expect(aborted.error.code).toBe("aborted");
    expect(calls[0]?.init.signal?.aborted).toBe(false);
    calls[0]?.respond(ANSWER);
    expect(await second).toEqual({ isSuccess: true, data: { rows: [1] } });
  });

  test("the request is aborted once every participant has aborted", async () => {
    const { dispatcher, calls } = setup();
    const firstCtrl = new AbortController();
    const secondCtrl = new AbortController();
    const first = dispatcher.query(QUERY_TYPE, { a: 1 }, {
      shareInFlight: true,
      signal: firstCtrl.signal,
    });
    const second = dispatcher.query(QUERY_TYPE, { a: 1 }, {
      shareInFlight: true,
      signal: secondCtrl.signal,
    });
    firstCtrl.abort();
    expect(calls[0]?.init.signal?.aborted).toBe(false);
    secondCtrl.abort();
    expect(calls[0]?.init.signal?.aborted).toBe(true);
    await Promise.all([first, second]);
  });

  test("a write ends the sharing for queries started afterwards", async () => {
    const { dispatcher, calls } = setup();
    const first = dispatcher.query(QUERY_TYPE, { a: 1 }, { shareInFlight: true });
    const write = dispatcher.write("f:write:x:save", {});
    const second = dispatcher.query(QUERY_TYPE, { a: 1 }, { shareInFlight: true });
    const queryCalls = calls.filter((call) => call.path.endsWith("/api/query"));
    expect(queryCalls).toHaveLength(2);
    for (const call of calls) {
      call.respond(call.path.endsWith("/api/write") ? { isSuccess: true, data: {} } : ANSWER);
    }
    await Promise.all([first, write, second]);
  });

  test("after the first answer a new shared query sends a new request", async () => {
    const { dispatcher, calls } = setup();
    const first = dispatcher.query(QUERY_TYPE, { a: 1 }, { shareInFlight: true });
    calls[0]?.respond(ANSWER);
    await first;
    const second = dispatcher.query(QUERY_TYPE, { a: 1 }, { shareInFlight: true });
    expect(calls).toHaveLength(2);
    calls[1]?.respond(ANSWER);
    await second;
  });
});
