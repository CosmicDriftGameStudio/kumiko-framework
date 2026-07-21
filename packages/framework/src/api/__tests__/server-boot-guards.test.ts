// buildServer boot-time guards + httpRoute verb wiring (PUT branch).

import { describe, expect, test } from "bun:test";
import {
  createEntity,
  createFileField,
  createRegistry,
  createTextField,
  defineFeature,
} from "../../engine";
import { buildServer } from "../server";

const JWT_SECRET = "server-boot-guards-test-secret-min-32-chars";

describe("buildServer — file-storage provider guard", () => {
  const fileFieldFeature = defineFeature("needs-files", (r) => {
    r.entity(
      "doc",
      createEntity({
        table: "boot_guard_docs",
        fields: { title: createTextField(), attachment: createFileField() },
      }),
    );
  });

  test("throws when registry declares file fields but no provider is mounted", () => {
    expect(() =>
      buildServer({
        registry: createRegistry([fileFieldFeature]),
        context: {},
        jwtSecret: JWT_SECRET,
      }),
    ).toThrow(/no file-storage provider is mounted/);
  });
});

describe("buildServer — rateLimit resolver guard", () => {
  test("throws when L1 global middleware requested without resolver", () => {
    expect(() =>
      buildServer({
        registry: createRegistry([]),
        context: {},
        jwtSecret: JWT_SECRET,
        rateLimit: { global: { limit: 100, windowSeconds: 60 } },
      }),
    ).toThrow(/rateLimit middleware requested but no resolver available/);
  });
});

describe("buildServer — feature httpRoute PUT mounting", () => {
  const putFeature = defineFeature("put-route", (r) => {
    r.httpRoute({
      method: "PUT",
      path: "/resource/42",
      anonymous: true,
      handler: (c) => c.json({ method: "PUT", ok: true }),
    });
  });

  const { app } = buildServer({
    registry: createRegistry([putFeature]),
    context: {},
    jwtSecret: JWT_SECRET,
  });

  test("PUT /resource/42 reaches the declared handler", async () => {
    const res = await app.request("/resource/42", { method: "PUT" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ method: "PUT", ok: true });
  });
});
