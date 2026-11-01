import { describe, expect, test } from "bun:test";
import { CONTACT_CLIENT_SOURCE } from "../client/contact-client-source.ts";
import type {
  ContactWebsiteClient,
  ContactWebsiteSubmitFields,
} from "../client/contact-website-client.ts";
import { hasLeadingZeroBits, verifyProofOfWork } from "../pow.ts";
import { deriveSubjectFromMessage } from "../subject.ts";
import { summarizeUserAgent } from "../user-agent.ts";
import { CONTACT_SUBJECT_MAX_CHARS } from "../web/constants.ts";

describe("hasLeadingZeroBits", () => {
  test("counts whole and partial bytes", () => {
    expect(hasLeadingZeroBits(new Uint8Array([0, 0b0001_0000]), 11)).toBe(true);
    expect(hasLeadingZeroBits(new Uint8Array([0, 0b0001_0000]), 12)).toBe(false);
    expect(hasLeadingZeroBits(new Uint8Array([1, 0]), 8)).toBe(false);
    expect(hasLeadingZeroBits(new Uint8Array([0]), 16)).toBe(false);
  });
});

describe("summarizeUserAgent", () => {
  test("names browser, version and OS in the page language", () => {
    const chromeMac =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
    expect(summarizeUserAgent(chromeMac, "de-DE")).toBe("Chrome 126 auf macOS");
    expect(summarizeUserAgent(chromeMac, "en-US")).toBe("Chrome 126 on macOS");
  });

  test("Edge wins over Chrome and iOS over macOS", () => {
    expect(
      summarizeUserAgent(
        "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/126.0 Safari/537.36 Edg/126.0",
        "en",
      ),
    ).toBe("Edge 126 on Windows");
    expect(
      summarizeUserAgent(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1",
        "en",
      ),
    ).toBe("Safari 17 on iOS");
  });

  test("returns null without a known browser", () => {
    expect(summarizeUserAgent(undefined, "en")).toBeNull();
    expect(summarizeUserAgent("curl/8.0", "en")).toBeNull();
  });
});

describe("deriveSubjectFromMessage", () => {
  test("uses the first non-empty line", () => {
    expect(deriveSubjectFromMessage("\n\n  Hello there \nsecond")).toBe("Hello there");
  });

  test("truncates long lines with an ellipsis within the limit", () => {
    const subject = deriveSubjectFromMessage("x".repeat(CONTACT_SUBJECT_MAX_CHARS + 50));
    expect([...subject]).toHaveLength(CONTACT_SUBJECT_MAX_CHARS);
    expect(subject.endsWith("…")).toBe(true);
  });
});

const WEBSITE_FIELDS: ContactWebsiteSubmitFields = {
  kind: "question",
  name: "Lea Hoffmann",
  email: "lea@hoffmann-it.example",
  message: "Kann ich die Statusseite unter einer eigenen Domain betreiben?",
};

type FetchCall = {
  path: string;
  credentials: string;
  body: { type: string; payload: Record<string, unknown> };
};

function loadClient(
  fetchImpl: (call: FetchCall) => { status: number; json: unknown; retryAfter?: string },
) {
  const calls: FetchCall[] = [];
  const windowStub: { KumikoContact?: ContactWebsiteClient } = {};
  const documentStub = { cookie: "kumiko_csrf=tok%20en", documentElement: { lang: "de" } };
  const fetchStub = async (path: string, init: { body: string; credentials: string }) => {
    const call: FetchCall = {
      path,
      credentials: init.credentials,
      body: JSON.parse(init.body),
    };
    calls.push(call);
    const result = fetchImpl(call);
    return {
      status: result.status,
      headers: {
        get: (name: string) => (name === "Retry-After" ? (result.retryAfter ?? null) : null),
      },
      json: async () => result.json,
    };
  };
  new Function("window", "document", "fetch", CONTACT_CLIENT_SOURCE)(
    windowStub,
    documentStub,
    fetchStub,
  );
  const client = windowStub.KumikoContact;
  if (!client) throw new Error("client did not register");
  return { client, calls };
}

describe("browser client", () => {
  const challenge = "0123456789abcdef0123456789abcdef";

  test("solves the challenge so the server's verifier accepts the nonce", async () => {
    const { client, calls } = loadClient((call) =>
      call.body.type === "contact:query:challenge"
        ? {
            status: 200,
            json: { data: { challenge, bits: 12, phone: "off", kinds: ["question"] } },
          }
        : { status: 200, json: { isSuccess: true } },
    );
    const result = await client.submit(WEBSITE_FIELDS);
    expect(result).toEqual({ kind: "sent" });
    const submitted = calls.find((call) => call.body.type === "contact:write:submit");
    expect(submitted?.body.payload["challenge"]).toBe(challenge);
    expect(submitted?.body.payload["locale"]).toBe("de");
    expect(
      verifyProofOfWork({
        challenge,
        nonce: String(submitted?.body.payload["nonce"]),
        bits: 12,
      }),
    ).toBe(true);
  });

  test("challenge and submit requests go out without credentials", async () => {
    const { client, calls } = loadClient((call) =>
      call.body.type === "contact:query:challenge"
        ? { status: 200, json: { data: { challenge, bits: 4, phone: "off", kinds: [] } } }
        : { status: 200, json: { isSuccess: true } },
    );
    await client.submit(WEBSITE_FIELDS);
    expect(calls.map((call) => call.body.type)).toEqual([
      "contact:query:challenge",
      "contact:write:submit",
    ]);
    expect(calls.map((call) => call.credentials)).toEqual(["omit", "omit"]);
  });

  test("maps 429 to rate-limited with the Retry-After seconds", async () => {
    const { client } = loadClient((call) =>
      call.body.type === "contact:query:challenge"
        ? { status: 200, json: { data: { challenge, bits: 4, phone: "off", kinds: [] } } }
        : { status: 429, json: {}, retryAfter: "42" },
    );
    expect(await client.submit(WEBSITE_FIELDS)).toEqual({
      kind: "rate-limited",
      retryAfterSeconds: 42,
    });
  });

  test("a failing challenge request yields failed", async () => {
    const { client } = loadClient(() => ({ status: 500, json: {} }));
    expect(await client.submit(WEBSITE_FIELDS)).toEqual({ kind: "failed" });
  });
});
