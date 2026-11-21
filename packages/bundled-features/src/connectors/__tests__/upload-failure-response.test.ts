import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { ConnectorErrors } from "../constants.ts";
import { uploadFailureResponse } from "../routes.ts";

async function answerTo(error: { code: string; details?: unknown }) {
  const app = new Hono();
  app.get("/", (c) => uploadFailureResponse(c, error, "item-1"));
  const res = await app.request("/");
  return { status: res.status, body: await res.json() };
}

describe("uploadFailureResponse", () => {
  test("a file that vanished between byte check and write answers a retry, not a server error", async () => {
    expect(
      await answerTo({
        code: "UNPROCESSABLE",
        details: { reason: ConnectorErrors.uploadNotPrepared },
      }),
    ).toEqual({ status: 409, body: { error: "retry" } });
  });

  test("an unknown failure stays a 500", async () => {
    expect(await answerTo({ code: "INTERNAL" })).toEqual({
      status: 500,
      body: { error: "server_error" },
    });
  });
});
