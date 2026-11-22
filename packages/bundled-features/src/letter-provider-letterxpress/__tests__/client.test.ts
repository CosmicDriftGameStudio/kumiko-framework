import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { createLetterXpressClient } from "../client.ts";
import { createStubTransport, fixture, type StubAnswer } from "./test-support.ts";

const USERNAME = "api-user-name";
const API_KEY = "api-key-must-never-leak";

function clientWith(answers: StubAnswer[], mode: "test" | "live" = "test") {
  const stub = createStubTransport(answers);
  const client = createLetterXpressClient({
    egress: stub.egress({ kind: "internal", allowOrigins: ["https://api.letterxpress.de"] }),
    username: USERNAME,
    apiKey: API_KEY,
    mode,
  });
  return { client, requests: stub.requests };
}

const SPECIFICATION = { color: "1", mode: "duplex", shipping: "national" } as const;
const PRICE_REQUEST = { pages: 3, specification: SPECIFICATION } as const;

describe("letterxpress client requests", () => {
  test("reads go out as POST with the GET override and carry the auth object in the body", async () => {
    const { client, requests } = clientWith([fixture("c2-price-bw-duplex-std")]);
    const result = await client.price(PRICE_REQUEST);

    expect(result).toEqual({ kind: "ok", data: { price: 1.08 } });
    const [request] = requests;
    expect(request?.url).toBe("https://api.letterxpress.de/v3/price");
    expect(request?.method).toBe("POST");
    expect(request?.headers.get("X-HTTP-Method-Override")).toBe("GET");
    expect(request?.headers.get("Content-Type")).toBe("application/json");
    expect(request?.body["auth"]).toEqual({ username: USERNAME, apikey: API_KEY, mode: "test" });
  });

  test("the mode of the client is the mode in the body", async () => {
    const { client, requests } = clientWith([fixture("c2-price-bw-duplex-std")], "live");
    await client.price(PRICE_REQUEST);
    expect(requests[0]?.body["auth"]).toMatchObject({ mode: "live" });
  });

  test("price sends pages, specification and the registered variant", async () => {
    const { client, requests } = clientWith([fixture("c5-price-bw-duplex-r1")]);
    const result = await client.price({ pages: 3, specification: SPECIFICATION, registered: "r1" });

    expect(result).toEqual({ kind: "ok", data: { price: 5.14 } });
    expect(requests[0]?.url).toBe("https://api.letterxpress.de/v3/price");
    expect(requests[0]?.body["letter"]).toEqual({
      specification: { pages: 3, ...SPECIFICATION },
      registered: "r1",
    });
  });

  test("price without a registered variant leaves the field out", async () => {
    const { client, requests } = clientWith([fixture("c2-price-bw-duplex-std")]);
    await client.price({ pages: 3, specification: SPECIFICATION });
    expect(requests[0]?.body["letter"]).toEqual({
      specification: { pages: 3, ...SPECIFICATION },
    });
  });

  test("createPrintJob sends the base64 file with the md5 of the base64 string", async () => {
    const { client, requests } = clientWith([fixture("d-submit-std")]);
    const pdf = new TextEncoder().encode("%PDF-1.4 not a real pdf");
    const result = await client.createPrintJob({
      pdf,
      specification: SPECIFICATION,
      notice: "letter-ref-1",
      filenameOriginal: "letter-letter-ref-1.pdf",
    });

    expect(result.kind).toBe("ok");
    const request = requests[0];
    expect(request?.method).toBe("POST");
    expect(request?.headers.has("X-HTTP-Method-Override")).toBe(false);
    const base64 = Buffer.from(pdf).toString("base64");
    expect(request?.body["letter"]).toEqual({
      base64_file: base64,
      base64_file_checksum: createHash("md5").update(base64).digest("hex"),
      specification: SPECIFICATION,
      notice: "letter-ref-1",
      filename_original: "letter-letter-ref-1.pdf",
    });
  });

  test("getPrintJob reads one order by id", async () => {
    const { client, requests } = clientWith([fixture("e1-get-job1")]);
    const result = await client.getPrintJob("10000001");
    expect(result.kind).toBe("ok");
    expect(requests[0]?.url).toBe("https://api.letterxpress.de/v3/printjobs/10000001");
    expect(requests[0]?.headers.get("X-HTTP-Method-Override")).toBe("GET");
  });

  test("an id that is not numeric never reaches the network", async () => {
    const { client, requests } = clientWith([]);
    expect(await client.getPrintJob("../balance")).toEqual({ kind: "not-found" });
    expect(await client.deletePrintJob("1/2")).toEqual({ kind: "not-found" });
    expect(requests).toHaveLength(0);
  });

  test("listPrintJobs asks for the filter and the page", async () => {
    const { client, requests } = clientWith([fixture("e2-list-draft")]);
    const result = await client.listPrintJobs("draft", 2);
    expect(result.kind).toBe("ok");
    expect(requests[0]?.url).toBe("https://api.letterxpress.de/v3/printjobs?filter=draft&page=2");
  });

  test("deletePrintJob sends a real DELETE with the auth body", async () => {
    const { client, requests } = clientWith([fixture("h1-delete-job1")]);
    expect(await client.deletePrintJob("10000001")).toEqual({ kind: "ok", data: null });
    expect(requests[0]?.method).toBe("DELETE");
    expect(requests[0]?.url).toBe("https://api.letterxpress.de/v3/printjobs/10000001");
    expect(requests[0]?.body["auth"]).toMatchObject({ username: USERNAME });
  });
});

describe("letterxpress client failures", () => {
  test("401 is unauthorized", async () => {
    const { client } = clientWith([fixture("i1-wrong-apikey")]);
    expect(await client.price(PRICE_REQUEST)).toEqual({ kind: "unauthorized" });
  });

  test("404 is not-found", async () => {
    const { client } = clientWith([fixture("i3-unknown-id")]);
    expect(await client.getPrintJob("999999999")).toEqual({ kind: "not-found" });
  });

  test("another status is an http-error with the provider message", async () => {
    const { client } = clientWith([fixture("i2-landscape")]);
    const result = await client.createPrintJob({
      pdf: new Uint8Array([1]),
      specification: SPECIFICATION,
      notice: "n",
      filenameOriginal: "f.pdf",
    });
    expect(result).toEqual({
      kind: "http-error",
      status: 500,
      message: "Das PDF ist verschlüsselt oder liegt nicht im richtigen Format vor (A4-Hochformat)",
    });
  });

  test("an answer that does not match the schema is invalid-response", async () => {
    const { client } = clientWith([
      { http_status: 200, body: { status: 200, message: "OK", data: { price: "a lot" } } },
    ]);
    expect(await client.price(PRICE_REQUEST)).toEqual({ kind: "invalid-response" });
  });

  test("an unknown order status is invalid-response", async () => {
    const answer = fixture("e1-get-job1");
    const body = JSON.parse(JSON.stringify(answer.body));
    body.data.status = "exploded";
    const { client } = clientWith([{ http_status: 200, body }]);
    expect(await client.getPrintJob("10000001")).toEqual({ kind: "invalid-response" });
  });

  test("a body that is no JSON is invalid-response", async () => {
    const client = createLetterXpressClient({
      egress: async () => new Response("<html>", { status: 200 }),
      username: USERNAME,
      apiKey: API_KEY,
      mode: "test",
    });
    expect(await client.price(PRICE_REQUEST)).toEqual({ kind: "invalid-response" });
  });

  test("a timeout and a network error are told apart", async () => {
    const timeout = new Error("slow");
    timeout.name = "TimeoutError";
    const { client } = clientWith([timeout, new Error("connection reset")]);
    expect(await client.price(PRICE_REQUEST)).toEqual({ kind: "timeout" });
    expect(await client.price(PRICE_REQUEST)).toEqual({ kind: "unreachable" });
  });

  test("no failure carries the key or the user name", async () => {
    const leaky = new Error(`boom ${API_KEY} ${USERNAME}`);
    const { client } = clientWith([
      leaky,
      fixture("i1-wrong-apikey"),
      fixture("i2-landscape"),
      { http_status: 200, body: { data: 1 } },
    ]);
    const results = [
      await client.price(PRICE_REQUEST),
      await client.price(PRICE_REQUEST),
      await client.createPrintJob({
        pdf: new Uint8Array([1]),
        specification: SPECIFICATION,
        notice: "n",
        filenameOriginal: "f.pdf",
      }),
      await client.price(PRICE_REQUEST),
    ];
    for (const result of results) {
      const text = JSON.stringify(result);
      expect(text).not.toContain(API_KEY);
      expect(text).not.toContain(USERNAME);
    }
  });
});
