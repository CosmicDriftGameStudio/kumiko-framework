// Regression guard for the request-locale wiring: X-Locale header (or, when
// absent, Accept-Language) must reach ctx.locale on real HTTP calls — the
// AsyncLocalStorage plumbing in request-id-middleware.ts / dispatch-shared.ts
// can't be exercised via createTestDispatcher, which skips the HTTP layer
// entirely.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { defineFeature, type SessionUser } from "@cosmicdrift/kumiko-framework/engine";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
} from "@cosmicdrift/kumiko-framework/stack";
import { z } from "zod";
import { LOCALE_HEADER_NAME } from "../api-constants";

const localeProbe = defineFeature("locale-probe", (r) => {
  r.writeHandler(
    "read-locale",
    z.object({}),
    async (_event, ctx) => ({ isSuccess: true, data: { locale: ctx.locale } }),
    { access: { openToAll: true } },
  );
});

async function readLocale(
  stack: TestStack,
  headers: Record<string, string>,
  user: SessionUser = createTestUser({ id: 1 }),
): Promise<string> {
  const res = await stack.http.writeWithHeaders(
    "locale-probe:write:read-locale",
    {},
    user,
    headers,
  );
  const body = (await res.json()) as { data: { locale: string } };
  return body.data.locale;
}

describe("ctx.locale resolution over real HTTP", () => {
  let stack: TestStack;

  beforeAll(async () => {
    stack = await setupTestStack({ features: [localeProbe] });
  });

  afterAll(async () => {
    await stack.cleanup();
  });

  test("X-Locale header wins", async () => {
    const locale = await readLocale(stack, { [LOCALE_HEADER_NAME]: "de-AT" });
    expect(locale).toBe("de-AT");
  });

  test("falls back to Accept-Language when X-Locale is absent", async () => {
    const locale = await readLocale(stack, { "accept-language": "fr-FR,fr;q=0.9,en;q=0.8" });
    expect(locale).toBe("fr-FR");
  });

  test("Accept-Language with only invalid tags falls back to the boot default", async () => {
    const locale = await readLocale(stack, { "accept-language": "*, ;q=0.1" });
    expect(locale).toBe("en");
  });

  test("a malformed/manipulated X-Locale header is rejected, not passed through", async () => {
    const locale = await readLocale(stack, {
      [LOCALE_HEADER_NAME]: "<script>alert(1)</script>",
    });
    expect(locale).toBe("en");
  });

  test("an invalid X-Locale header falls through to a valid Accept-Language instead of the default", async () => {
    const locale = await readLocale(stack, {
      [LOCALE_HEADER_NAME]: "not-a-real-locale-tag-way-too-long-to-be-valid",
      "accept-language": "es-ES",
    });
    expect(locale).toBe("es-ES");
  });
});

describe("ctx.locale falls back to the app's boot-configured defaultLocale", () => {
  let stack: TestStack;

  beforeAll(async () => {
    stack = await setupTestStack({
      features: [localeProbe],
      extraContext: { defaultLocale: "ja" },
    });
  });

  afterAll(async () => {
    await stack.cleanup();
  });

  test("no header signal at all uses the app's defaultLocale, not the hardcoded default", async () => {
    const locale = await readLocale(stack, {});
    expect(locale).toBe("ja");
  });
});

// fw#2333 — SessionUser.locale (persisted at login) sits between the
// request-layer signal and the boot default: no live request signal falls
// back to it, but a live signal still wins over it.
describe("ctx.locale falls back to SessionUser.locale ahead of the boot default", () => {
  let stack: TestStack;

  beforeAll(async () => {
    stack = await setupTestStack({
      features: [localeProbe],
      extraContext: { defaultLocale: "ja" },
    });
  });

  afterAll(async () => {
    await stack.cleanup();
  });

  test("no header signal falls back to the persisted SessionUser.locale", async () => {
    const locale = await readLocale(stack, {}, createTestUser({ id: 1, locale: "de-DE" }));
    expect(locale).toBe("de-DE");
  });

  test("X-Locale header still wins over a persisted SessionUser.locale", async () => {
    const locale = await readLocale(
      stack,
      { [LOCALE_HEADER_NAME]: "fr-FR" },
      createTestUser({ id: 1, locale: "de-DE" }),
    );
    expect(locale).toBe("fr-FR");
  });

  test("a forged/malformed SessionUser.locale falls through to the boot default", async () => {
    const locale = await readLocale(
      stack,
      {},
      createTestUser({ id: 1, locale: "<script>alert(1)</script>" }),
    );
    expect(locale).toBe("ja");
  });

  test("no SessionUser.locale set falls through to the boot default", async () => {
    const locale = await readLocale(stack, {}, createTestUser({ id: 1 }));
    expect(locale).toBe("ja");
  });
});
