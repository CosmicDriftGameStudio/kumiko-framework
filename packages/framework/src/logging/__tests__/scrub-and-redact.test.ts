import { describe, expect, test } from "bun:test";
import { requestContext } from "../../api/request-context.ts";
import { setRequestIdentity } from "../../api/request-context-internals.ts";

import { createLogger } from "../pino-logger.ts";
import { scrubLogText } from "../scrub.ts";

function captureLogger() {
  const lines: Record<string, unknown>[] = [];
  const logger = createLogger({
    destination: {
      write(chunk: string) {
        lines.push(JSON.parse(chunk));
      },
    },
  });
  return { logger, lines };
}

describe("scrubLogText", () => {
  test("masks email addresses but keeps the first character and the domain", () => {
    expect(scrubLogText("sent to anna.meier@example.com failed")).toBe(
      "sent to a***@example.com failed",
    );
  });

  test("masks the values of a Postgres unique-violation detail", () => {
    expect(
      scrubLogText("duplicate key. Key (tenant_id, email)=(t-1, bob@x.de) already exists."),
    ).toBe("duplicate key. Key (tenant_id, email)=(***) already exists.");
  });

  test("masks the row of a Postgres failing-row detail", () => {
    expect(scrubLogText("null value. Failing row contains (1, secret, bob)")).toBe(
      "null value. Failing row contains (***)",
    );
  });

  test("masks JWTs and bearer tokens", () => {
    expect(scrubLogText("token eyJhbGciOi.eyJzdWIiOiIx.sig_-1 rejected")).toBe(
      "token [jwt] rejected",
    );
    expect(scrubLogText("sent Bearer abc.def123 to upstream")).toBe(
      "sent Bearer [redacted] to upstream",
    );
  });

  test("leaves text without personal data untouched", () => {
    expect(scrubLogText("handler failed at step 3")).toBe("handler failed at step 3");
  });
});

describe("createLogger redaction", () => {
  test.each([
    ["depth 0", { password: "hunter2" }],
    ["depth 1", { body: { password: "hunter2" } }],
    ["depth 2", { req: { body: { password: "hunter2" } } }],
  ])("redacts sensitive keys at %s", (_name, data) => {
    const { logger, lines } = captureLogger();

    logger.info("login", data);

    expect(JSON.stringify(lines[0])).not.toContain("hunter2");
    expect(JSON.stringify(lines[0])).toContain("[redacted]");
  });

  test("redacts every listed key and keeps unrelated fields", () => {
    const { logger, lines } = captureLogger();

    logger.info("x", {
      token: "t",
      accessToken: "a",
      refreshToken: "r",
      idToken: "i",
      secret: "s",
      clientSecret: "c",
      apiKey: "k",
      authorization: "Bearer z",
      cookie: "sid=1",
      iban: "DE00",
      email: "a@b.de",
      passwordHash: "h",
      newPassword: "n",
      "set-cookie": "sid=2",
      "x-api-key": "xk",
      sessionToken: "st",
      privateKey: "pk",
      credentials: "cr",
      otp: "123456",
      job: "keep-me",
    });

    const line = lines[0] ?? {};
    expect(line["job"]).toBe("keep-me");
    for (const key of [
      "token",
      "accessToken",
      "refreshToken",
      "idToken",
      "secret",
      "clientSecret",
      "apiKey",
      "authorization",
      "cookie",
      "iban",
      "email",
      "passwordHash",
      "newPassword",
      "set-cookie",
      "x-api-key",
      "sessionToken",
      "privateKey",
      "credentials",
      "otp",
    ]) {
      expect(line[key]).toBe("[redacted]");
    }
  });
});

describe("createLogger redaction of hyphenated keys at depth", () => {
  test("redacts set-cookie in a nested headers object", () => {
    const { logger, lines } = captureLogger();

    logger.info("x", { headers: { "set-cookie": "sid=2" } });

    expect(JSON.stringify(lines[0])).not.toContain("sid=2");
  });
});

describe("createLogger request context fields", () => {
  test("a log inside requestContext.run carries ids, identity, feature and handler", () => {
    const { logger, lines } = captureLogger();

    requestContext.run(
      { requestId: "req-1", correlationId: "corr-1", feature: "orders", handler: "orders:write:x" },
      () => {
        setRequestIdentity({ tenantId: "tenant-1", userId: "user-1" });
        logger.info("inside");
      },
    );

    expect(lines[0]).toMatchObject({
      requestId: "req-1",
      correlationId: "corr-1",
      tenantId: "tenant-1",
      userId: "user-1",
      feature: "orders",
      handler: "orders:write:x",
    });
  });

  test("a log outside any request carries none of them", () => {
    const { logger, lines } = captureLogger();

    logger.info("outside");

    const line = lines[0] ?? {};
    expect(line).not.toHaveProperty("requestId");
    expect(line).not.toHaveProperty("tenantId");
  });

  test("unset identity fields are omitted", () => {
    const { logger, lines } = captureLogger();

    requestContext.run({ requestId: "req-2", correlationId: "req-2" }, () => logger.info("anon"));

    const line = lines[0] ?? {};
    expect(line["requestId"]).toBe("req-2");
    expect(line).not.toHaveProperty("userId");
  });
});
