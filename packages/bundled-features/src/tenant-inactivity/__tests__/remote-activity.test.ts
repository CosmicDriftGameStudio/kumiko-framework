import { describe, expect, test } from "bun:test";
import { fetchRemoteAppLastActivity } from "../remote-activity.ts";

const URL_UNDER_TEST = "https://other-app.test/sessions/last-activity";

function answering(body: unknown, status = 200) {
  const calls: { url: string; authorization: string | null }[] = [];
  const send = async (url: string, init: RequestInit) => {
    calls.push({ url, authorization: new Headers(init.headers).get("authorization") });
    return new Response(JSON.stringify(body), { status });
  };
  return { send, calls };
}

describe("fetchRemoteAppLastActivity", () => {
  test("sends the bearer secret and parses the instant", async () => {
    const { send, calls } = answering({ lastActivityAt: "2030-03-02T09:30:00Z" });
    const found = await fetchRemoteAppLastActivity({ url: URL_UNDER_TEST, secret: "s3cret", send });
    expect(found?.toString()).toBe("2030-03-02T09:30:00Z");
    expect(calls).toEqual([{ url: URL_UNDER_TEST, authorization: "Bearer s3cret" }]);
  });

  test("null means the other app has no sessions", async () => {
    const { send } = answering({ lastActivityAt: null });
    expect(await fetchRemoteAppLastActivity({ url: URL_UNDER_TEST, secret: "x", send })).toBeNull();
  });

  test("a failed or malformed answer throws instead of reading as no activity", async () => {
    await expect(
      fetchRemoteAppLastActivity({
        url: URL_UNDER_TEST,
        secret: "x",
        send: answering({}, 401).send,
      }),
    ).rejects.toThrow("401");
    await expect(
      fetchRemoteAppLastActivity({
        url: URL_UNDER_TEST,
        secret: "x",
        send: answering({ at: 1 }).send,
      }),
    ).rejects.toThrow();
  });
});
