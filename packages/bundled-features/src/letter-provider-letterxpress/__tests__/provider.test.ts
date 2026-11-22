import { describe, expect, test } from "bun:test";
import type {
  LetterProviderContext,
  LetterShippingMode,
  LetterSpec,
  LetterSubmission,
} from "@cosmicdrift/kumiko-bundled-features/letter-foundation";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { LETTERXPRESS_FIND_MAX_PAGES } from "../constants.ts";
import {
  buildLetterXpressProvider,
  letterXpressCapabilities,
  letterXpressPlugin,
} from "../provider.ts";
import { createStubTransport, fixture, type StubAnswer } from "./test-support.ts";

const USERNAME = "api-user-name";
const API_KEY = "api-key-must-never-leak";
const ACCEPTED_AT = Temporal.Instant.from("2026-11-22T20:00:00Z");

function spec(overrides: Partial<LetterSpec> = {}): LetterSpec {
  return {
    pageCount: 3,
    sheetCount: 2,
    shippingMode: "standard",
    color: false,
    duplex: true,
    envelope: "folded",
    ...overrides,
  };
}

function submission(overrides: Partial<LetterSpec> = {}): LetterSubmission {
  return {
    reference: "letter-ref-1",
    pdf: new TextEncoder().encode("%PDF-1.4 test"),
    spec: spec(overrides),
    expectedRecipient: {
      name: "Erika Mustermann",
      street: "Musterstraße",
      houseNumber: "12",
      postalCode: "12345",
      city: "Musterstadt",
    },
  };
}

async function providerWith(
  answers: StubAnswer[],
  options: {
    live?: boolean;
    env?: LetterProviderContext["env"];
    wait?: (ms: number) => Promise<void>;
  } = {},
) {
  const stub = createStubTransport(answers);
  const ctx: LetterProviderContext = {
    live: options.live ?? false,
    env: options.env ?? { LETTERXPRESS_USERNAME: USERNAME, LETTERXPRESS_API_KEY: API_KEY },
    egress: stub.egress,
  };
  const provider = await buildLetterXpressProvider(ctx, {
    now: () => ACCEPTED_AT,
    ...(options.wait !== undefined && { wait: options.wait }),
  });
  return { provider, requests: stub.requests, policies: stub.policies };
}

function jobWithStatus(status: string): StubAnswer {
  const answer = fixture("e1-get-job1");
  const body = JSON.parse(JSON.stringify(answer.body));
  body.data.status = status;
  return { http_status: 200, body };
}

describe("build", () => {
  test("binds the egress policy to the API host only", async () => {
    const { policies } = await providerWith([]);
    expect(policies).toEqual([{ kind: "internal", allowOrigins: ["https://api.letterxpress.de"] }]);
  });

  test("missing credentials throw with the variable names and no value", async () => {
    const stub = createStubTransport([]);
    const build = letterXpressPlugin.build({
      live: false,
      env: { LETTERXPRESS_USERNAME: USERNAME },
      egress: stub.egress,
    });
    const error = await build.then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(Error);
    const message = error instanceof Error ? error.message : "";
    expect(message).toContain("LETTERXPRESS_USERNAME");
    expect(message).toContain("LETTERXPRESS_API_KEY");
    expect(message).not.toContain(USERNAME);
  });

  test("capabilities offer no return receipt and the documented limits", () => {
    expect(letterXpressCapabilities.shippingModes).toEqual(["standard", "einwurf", "uebergabe"]);
    expect(letterXpressCapabilities.maxBytes).toBe(50 * 1024 * 1024);
    expect(letterXpressCapabilities.cancelWindowSeconds).toBe(900);
  });
});

describe("mode", () => {
  test("without the live switch every request says test", async () => {
    const { provider, requests } = await providerWith([
      fixture("c2-price-bw-duplex-std"),
      fixture("d-submit-std"),
      fixture("e1-get-job1"),
    ]);
    await provider.quote(spec());
    await provider.submit(submission());
    await provider.status("10000001");
    expect(requests).toHaveLength(3);
    for (const request of requests) {
      expect(request.body["auth"]).toMatchObject({ mode: "test" });
    }
  });

  test("with the live switch the requests say live", async () => {
    const { provider, requests } = await providerWith([fixture("c2-price-bw-duplex-std")], {
      live: true,
    });
    await provider.quote(spec());
    expect(requests[0]?.body["auth"]).toMatchObject({ mode: "live" });
  });
});

describe("quote", () => {
  test("turns the gross price into net cents (1,08 -> 0,91)", async () => {
    const { provider, requests } = await providerWith([fixture("c2-price-bw-duplex-std")]);
    const quote = await provider.quote(spec());
    expect(quote).toEqual({ net: { amount: 91, currency: "EUR" }, priceSource: "provider-api" });
    expect(requests[0]?.body["letter"]).toEqual({
      specification: { pages: 3, color: "1", mode: "duplex", shipping: "national" },
    });
  });

  test("registered mail: 5,14 gross -> 4,32 net, einwurf asks for r1", async () => {
    const { provider, requests } = await providerWith([fixture("c5-price-bw-duplex-r1")]);
    const quote = await provider.quote(spec({ shippingMode: "einwurf" }));
    expect(quote.net.amount).toBe(432);
    expect(requests[0]?.body["letter"]).toMatchObject({ registered: "r1" });
  });

  test.each([
    ["standard", undefined],
    ["einwurf", "r1"],
    ["uebergabe", "r2"],
  ] as const)(
    "shipping mode %s maps to registered %p",
    async (mode: LetterShippingMode, registered) => {
      const { provider, requests } = await providerWith([fixture("c2-price-bw-duplex-std")]);
      await provider.quote(spec({ shippingMode: mode }));
      const letter = requests[0]?.body["letter"];
      expect(letter).toMatchObject(registered === undefined ? {} : { registered });
      expect(JSON.stringify(letter).includes("registered")).toBe(registered !== undefined);
    },
  );

  test("colour simplex asks for color 4 and simplex", async () => {
    const { provider, requests } = await providerWith([fixture("c3-price-color-duplex-std")]);
    await provider.quote(spec({ color: true, duplex: false }));
    expect(requests[0]?.body["letter"]).toMatchObject({
      specification: { color: "4", mode: "simplex" },
    });
  });

  test("a failing price call throws", async () => {
    const { provider } = await providerWith([fixture("i1-wrong-apikey")]);
    await expect(provider.quote(spec())).rejects.toThrow("401");
  });
});

describe("envelope", () => {
  test("flat asks for the C4 envelope in the price and in the order", async () => {
    const { provider, requests } = await providerWith([
      fixture("c2-price-bw-duplex-std"),
      fixture("d-submit-std"),
    ]);
    await provider.quote(spec({ envelope: "flat" }));
    await provider.submit(submission({ envelope: "flat" }));
    expect(requests[0]?.body["letter"]).toMatchObject({ specification: { c4: 1 } });
    expect(requests[1]?.body["letter"]).toMatchObject({ specification: { c4: 1 } });
  });

  test("above 8 sheets the C4 option is left out, the provider only takes it below 9", async () => {
    const { provider, requests } = await providerWith([fixture("c2-price-bw-duplex-std")]);
    await provider.quote(spec({ envelope: "flat", sheetCount: 9, pageCount: 18 }));
    expect(requests[0]?.body["letter"]).toEqual({
      specification: { pages: 18, color: "1", mode: "duplex", shipping: "national" },
    });
  });
});

describe("submit", () => {
  test("accepted: id, net, vat, recognized address, cancel deadline", async () => {
    const { provider, requests } = await providerWith([fixture("d-submit-std")]);
    const result = await provider.submit(submission());

    expect(result).toEqual({
      kind: "accepted",
      providerJobId: "10000001",
      actualNet: { amount: 91, currency: "EUR" },
      actualVat: { amount: 17, currency: "EUR" },
      recognizedAddress:
        "Beispiel Hausverwaltung GmbH, Beispielweg 1, 54321 Beispielstadt, , Erika Mustermann, Musterstraße 12, 12345 Musterstadt",
      cancelableUntil: ACCEPTED_AT.add({ seconds: 900 }),
      trackingNumber: undefined,
    });
    expect(requests[0]?.body["letter"]).toMatchObject({
      notice: "letter-ref-1",
      filename_original: "letter-letter-ref-1.pdf",
      specification: { color: "1", mode: "duplex", shipping: "national" },
    });
  });

  test("registered mail sends r2 for uebergabe", async () => {
    const { provider, requests } = await providerWith([fixture("g1-submit-r1")]);
    const result = await provider.submit(submission({ shippingMode: "uebergabe" }));
    expect(requests[0]?.body["letter"]).toMatchObject({ registered: "r2" });
    expect(result).toMatchObject({ kind: "accepted", providerJobId: "10000002" });
  });

  test("401 is a rejection with the provider reason, not an exception", async () => {
    const { provider } = await providerWith([fixture("i1-wrong-apikey")]);
    const result = await provider.submit(submission());
    expect(result.kind).toBe("rejected");
    if (result.kind === "rejected") expect(result.code).toBe("refused-by-provider");
  });

  test("400 carries the provider message", async () => {
    const { provider } = await providerWith([
      { http_status: 400, body: { status: 400, message: "Bad Request: checksum" } },
    ]);
    expect(await provider.submit(submission())).toEqual({
      kind: "rejected",
      code: "refused-by-provider",
      message: "Bad Request: checksum",
    });
  });

  describe("429", () => {
    const throttled = (headers?: Record<string, string>): StubAnswer => ({
      http_status: 429,
      body: { status: 429, message: "Too Many Requests" },
      ...(headers !== undefined && { headers }),
    });

    test("one throttled answer waits Retry-After once and then submits again", async () => {
      const waits: number[] = [];
      const { provider, requests } = await providerWith(
        [throttled({ "Retry-After": "3" }), fixture("d-submit-std")],
        { wait: async (ms) => void waits.push(ms) },
      );
      const result = await provider.submit(submission());
      expect(result).toMatchObject({ kind: "accepted", providerJobId: "10000001" });
      expect(waits).toEqual([3000]);
      expect(requests).toHaveLength(2);
    });

    test("the wait is capped and defaults to 2 s without the header", async () => {
      const waits: number[] = [];
      const wait = async (ms: number) => void waits.push(ms);
      const capped = await providerWith(
        [throttled({ "Retry-After": "120" }), fixture("d-submit-std")],
        { wait },
      );
      await capped.provider.submit(submission());
      const bare = await providerWith([throttled(), fixture("d-submit-std")], { wait });
      await bare.provider.submit(submission());
      expect(waits).toEqual([10_000, 2000]);
    });

    test("a second throttled answer is a rejection, not an exception", async () => {
      const { provider, requests } = await providerWith([throttled(), throttled()], {
        wait: async () => {},
      });
      const result = await provider.submit(submission());
      expect(result).toMatchObject({ kind: "rejected", code: "refused-by-provider" });
      if (result.kind === "rejected") {
        expect(result.message).toContain("throttling");
        expect(result.message).toContain("nothing was created");
      }
      expect(requests).toHaveLength(2);
    });
  });

  test("500 throws, because the outcome is unknown", async () => {
    const { provider } = await providerWith([fixture("i2-landscape")]);
    await expect(provider.submit(submission())).rejects.toThrow("HTTP 500");
  });

  test("a timeout throws", async () => {
    const timeout = new Error("slow");
    timeout.name = "TimeoutError";
    const { provider } = await providerWith([timeout]);
    await expect(provider.submit(submission())).rejects.toThrow();
  });

  test("an unreadable answer throws", async () => {
    const { provider } = await providerWith([{ http_status: 200, body: { data: {} } }]);
    await expect(provider.submit(submission())).rejects.toThrow("documented shape");
  });

  test("no error message contains the key", async () => {
    const leaky = new Error(`socket ${API_KEY}`);
    const { provider } = await providerWith([
      fixture("i2-landscape"),
      { http_status: 200, body: 1 },
    ]);
    const messages: string[] = [];
    for (const attempt of [provider.submit(submission()), provider.submit(submission())]) {
      const error = await attempt.then(
        () => undefined,
        (e: unknown) => e,
      );
      messages.push(error instanceof Error ? error.message : "");
    }
    expect(leaky.message).toContain(API_KEY);
    for (const message of messages) {
      expect(message).not.toContain(API_KEY);
      expect(message).not.toContain(USERNAME);
    }
  });
});

describe("capabilities", () => {
  test("a lookup costs one request per scanned list page", () => {
    expect(letterXpressCapabilities.lookupRequestsPerLetter).toBe(3 * LETTERXPRESS_FIND_MAX_PAGES);
  });
});

describe("status", () => {
  test.each([
    ["queue", "queued"],
    ["draft", "queued"],
    ["hold", "on-hold"],
    ["done", "sent"],
    ["canceled", "canceled"],
  ] as const)("order status %s is state %s", async (jobStatus, state) => {
    const { provider } = await providerWith([jobWithStatus(jobStatus)]);
    expect((await provider.status("10000001")).state).toBe(state);
  });

  test("an unknown id is not-found", async () => {
    const { provider } = await providerWith([fixture("i3-unknown-id")]);
    expect(await provider.status("999999999")).toEqual({ state: "not-found" });
  });

  test("an unknown order status throws instead of being mapped", async () => {
    const { provider } = await providerWith([jobWithStatus("exploded")]);
    await expect(provider.status("10000001")).rejects.toThrow("documented shape");
  });

  test("tracking number and status of a delivered registered letter", async () => {
    const { provider } = await providerWith([fixture("from-docs/get-job-done-registered")]);
    expect(await provider.status("10000003")).toEqual({
      state: "sent",
      trackingNumber: "RC123456789DE",
      trackingStatus: "Zugestellt: Die Sendung wurde am 27.07.22 13:32:29 erfolgreich zugestellt.",
      recognizedAddress: "Jim Knopf, Bahnhofstr. 1, 21337 Lüneburg",
    });
  });

  test('the placeholder tracking status "--" and a null tracking code are left out', async () => {
    const { provider } = await providerWith([fixture("g2-get-job2")]);
    const status = await provider.status("10000002");
    expect(status.trackingNumber).toBeUndefined();
    expect(status.trackingStatus).toBeUndefined();
    expect(status.recognizedAddress).toContain("Erika Mustermann");
  });

  test("an order without tracking fields maps cleanly", async () => {
    const { provider } = await providerWith([fixture("from-docs/get-job-queue")]);
    expect(await provider.status("10000004")).toMatchObject({ state: "queued" });
  });
});

describe("cancel", () => {
  test("a deleted order is canceled", async () => {
    const { provider, requests } = await providerWith([fixture("h1-delete-job1")]);
    expect(await provider.cancel?.("10000001")).toEqual({ kind: "canceled" });
    expect(requests[0]?.method).toBe("DELETE");
  });

  test("an unknown id is refused as unknown_job", async () => {
    const { provider } = await providerWith([fixture("i3-unknown-id")]);
    expect(await provider.cancel?.("999999999")).toEqual({
      kind: "refused",
      reason: "unknown_job",
    });
  });

  test("a refusal for an order that is done is already_processed", async () => {
    const { provider } = await providerWith([
      { http_status: 403, body: { status: 403, message: "Forbidden" } },
      jobWithStatus("done"),
    ]);
    expect(await provider.cancel?.("10000001")).toEqual({
      kind: "refused",
      reason: "already_processed",
    });
  });

  test("any other refusal is window_closed", async () => {
    const { provider } = await providerWith([
      { http_status: 403, body: { status: 403, message: "Forbidden" } },
      jobWithStatus("queue"),
    ]);
    expect(await provider.cancel?.("10000001")).toEqual({
      kind: "refused",
      reason: "window_closed",
    });
  });

  test("a server error throws", async () => {
    const { provider } = await providerWith([
      { http_status: 500, body: { status: 500, message: "boom" } },
    ]);
    await expect(provider.cancel?.("10000001")).rejects.toThrow("HTTP 500");
  });

  test("refused credentials throw instead of reading as a closed window", async () => {
    const { provider, requests } = await providerWith([fixture("i1-wrong-apikey")]);
    await expect(provider.cancel?.("10000001")).rejects.toThrow("credentials");
    expect(requests).toHaveLength(1);
  });

  test("a refusal whose status lookup fails throws", async () => {
    const { provider } = await providerWith([
      { http_status: 403, body: { status: 403, message: "Forbidden" } },
      { http_status: 500, body: { status: 500, message: "boom" } },
    ]);
    await expect(provider.cancel?.("10000001")).rejects.toThrow("HTTP 500");
  });
});

describe("findByReference", () => {
  function listPage(notices: readonly string[], page: number, lastPage: number): StubAnswer {
    const list = fixture("e2-list-draft");
    const body = JSON.parse(JSON.stringify(list.body));
    const template = body.data.printjobs[0];
    body.data.printjobs = notices.map((notice, index) => ({
      ...template,
      id: 10000100 + page * 10 + index,
      notice,
    }));
    body.data.pagination.current_page = page;
    body.data.pagination.last_page = lastPage;
    return { http_status: 200, body };
  }

  test("finds the order in test mode through the draft list", async () => {
    const { provider, requests } = await providerWith([fixture("e2-list-draft")]);
    const result = await provider.findByReference?.("letter-ref-1");
    expect(result).toMatchObject({
      kind: "accepted",
      providerJobId: "10000001",
      actualNet: { amount: 91, currency: "EUR" },
      actualVat: { amount: 17, currency: "EUR" },
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toContain("filter=draft");
  });

  test("no hit returns null", async () => {
    const { provider } = await providerWith([fixture("e2-list-draft")]);
    expect(await provider.findByReference?.("another-letter")).toBeNull();
  });

  test("looks on the second page when the first has no hit", async () => {
    const { provider, requests } = await providerWith([
      listPage(["x1", "x2"], 1, 2),
      listPage(["x3", "wanted"], 2, 2),
    ]);
    const result = await provider.findByReference?.("wanted");
    expect(result).toMatchObject({ kind: "accepted", providerJobId: "10000121" });
    expect(requests.map((request) => request.url)).toEqual([
      "https://api.letterxpress.de/v3/printjobs?filter=draft&page=1",
      "https://api.letterxpress.de/v3/printjobs?filter=draft&page=2",
    ]);
  });

  test("stops after the page limit", async () => {
    const pages = [1, 2, 3, 4].map((page) => listPage(["x"], page, 99));
    const { provider, requests } = await providerWith(pages);
    expect(await provider.findByReference?.("wanted")).toBeNull();
    expect(requests).toHaveLength(4);
  });

  test("in live mode it searches queue, hold and done", async () => {
    const empty = listPage([], 1, 1);
    const { provider, requests } = await providerWith([empty, empty, empty], { live: true });
    expect(await provider.findByReference?.("wanted")).toBeNull();
    expect(requests.map((request) => request.url.split("?")[1])).toEqual([
      "filter=queue&page=1",
      "filter=hold&page=1",
      "filter=done&page=1",
    ]);
  });

  test("a failing list call throws", async () => {
    const { provider } = await providerWith([fixture("i1-wrong-apikey")]);
    await expect(provider.findByReference?.("wanted")).rejects.toThrow("401");
  });
});

describe("findByJobId", () => {
  test("returns the order with the reference it was placed under", async () => {
    const { provider, requests } = await providerWith([fixture("e1-get-job1")]);
    const order = await provider.findByJobId?.("10000001");
    expect(order?.reference).toBe("letter-ref-1");
    expect(order?.acceptance.providerJobId).toBe("10000001");
    expect(order?.acceptance.actualNet).toEqual({ amount: 91, currency: "EUR" });
    expect(requests[0]?.url).toBe("https://api.letterxpress.de/v3/printjobs/10000001");
  });

  test("an unknown id is null", async () => {
    const { provider } = await providerWith([fixture("i3-unknown-id")]);
    expect(await provider.findByJobId?.("999999999")).toBeNull();
  });

  test("a canceled order is null, so it is never accepted", async () => {
    const { provider } = await providerWith([jobWithStatus("canceled")]);
    expect(await provider.findByJobId?.("10000001")).toBeNull();
  });

  test("a failing call throws", async () => {
    const { provider } = await providerWith([fixture("i1-wrong-apikey")]);
    await expect(provider.findByJobId?.("10000001")).rejects.toThrow("401");
  });
});
