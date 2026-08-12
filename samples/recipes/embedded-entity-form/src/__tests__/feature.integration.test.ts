// Embedded Entity Form Sample — Integration Test
// Proves: prospect:accept merges client changes onto the suggestion it
// already knows, stamps provenance the client never sent, flips the
// suggestion to accepted, and rejects a second accept on the same
// suggestion.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { SaveContext } from "@cosmicdrift/kumiko-framework/engine";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  TestUsers,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { prospectEntity, prospectsFeature, suggestionEntity } from "../feature";

let stack: TestStack;

const admin = TestUsers.admin;
const viewer = createTestUser({ id: 2, roles: ["Viewer"] });

async function seedSuggestion(overrides: Partial<Record<string, unknown>> = {}): Promise<string> {
  const created = await stack.http.writeOk<SaveContext>(
    "prospects:write:suggestion:create",
    { name: "Max Mustermann", email: "max@test.de", company: "Acme", ...overrides },
    admin,
  );
  return created.id as string;
}

beforeAll(async () => {
  stack = await setupTestStack({ features: [prospectsFeature] });
  await unsafeCreateEntityTable(stack.db, suggestionEntity);
  await unsafeCreateEntityTable(stack.db, prospectEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

describe("prospect:accept", () => {
  test("creates a prospect merged from the suggestion, no client-sent changes", async () => {
    const suggestionId = await seedSuggestion();

    const accepted = await stack.http.writeOk<SaveContext>(
      "prospects:write:prospect:accept",
      { suggestionId, changes: {} },
      admin,
    );

    expect(accepted.data["name"]).toBe("Max Mustermann");
    expect(accepted.data["email"]).toBe("max@test.de");
    expect(accepted.data["company"]).toBe("Acme");
    expect(accepted.data["source"]).toBe(`suggestion:${suggestionId}`);
    expect(accepted.data["acceptedBy"]).toBe(`user:${admin.id}`);
    expect(typeof accepted.data["acceptedAt"]).toBe("string");
  });

  test("client changes override the suggestion's field values", async () => {
    const suggestionId = await seedSuggestion({ name: "Draft Name" });

    const accepted = await stack.http.writeOk<SaveContext>(
      "prospects:write:prospect:accept",
      { suggestionId, changes: { name: "Corrected Name" } },
      admin,
    );

    expect(accepted.data["name"]).toBe("Corrected Name");
  });

  test("client-sent provenance fields in changes are ignored, not adopted", async () => {
    const suggestionId = await seedSuggestion();

    const accepted = await stack.http.writeOk<SaveContext>(
      "prospects:write:prospect:accept",
      {
        suggestionId,
        changes: { name: "X", source: "evil", acceptedBy: "user:999" },
      },
      admin,
    );

    expect(accepted.data["name"]).toBe("X");
    expect(accepted.data["source"]).toBe(`suggestion:${suggestionId}`);
    expect(accepted.data["acceptedBy"]).toBe(`user:${admin.id}`);
  });

  test("flips the suggestion to accepted", async () => {
    const suggestionId = await seedSuggestion();

    await stack.http.writeOk<SaveContext>(
      "prospects:write:prospect:accept",
      { suggestionId, changes: {} },
      admin,
    );

    const detail = await stack.http.queryOk<Record<string, unknown>>(
      "prospects:query:suggestion:detail",
      { id: suggestionId },
      admin,
    );
    expect(detail["status"]).toBe("accepted");
  });

  test("a second accept on the same suggestion is rejected", async () => {
    const suggestionId = await seedSuggestion();

    await stack.http.writeOk<SaveContext>(
      "prospects:write:prospect:accept",
      { suggestionId, changes: {} },
      admin,
    );

    const error = await stack.http.writeErr(
      "prospects:write:prospect:accept",
      { suggestionId, changes: {} },
      admin,
    );
    expect(error.code).toBe("unprocessable");
  });

  test("accepting an unknown suggestion is rejected", async () => {
    const error = await stack.http.writeErr(
      "prospects:write:prospect:accept",
      { suggestionId: "00000000-0000-4000-8000-000000000999", changes: {} },
      admin,
    );
    expect(error.code).toBe("not_found");
  });

  test("only Admin can accept", async () => {
    const suggestionId = await seedSuggestion();

    const error = await stack.http.writeErr(
      "prospects:write:prospect:accept",
      { suggestionId, changes: {} },
      viewer,
    );
    expect(error.code).toBe("access_denied");
  });

  test("clearing the email via changes is accepted, not rejected as an invalid address", async () => {
    const suggestionId = await seedSuggestion();

    const accepted = await stack.http.writeOk<SaveContext>(
      "prospects:write:prospect:accept",
      { suggestionId, changes: { email: "" } },
      admin,
    );

    expect(accepted.data["email"]).toBe("");
  });
});

describe("prospect:detail", () => {
  test("reads back the created prospect", async () => {
    const suggestionId = await seedSuggestion();
    const accepted = await stack.http.writeOk<SaveContext>(
      "prospects:write:prospect:accept",
      { suggestionId, changes: {} },
      admin,
    );

    const detail = await stack.http.queryOk<Record<string, unknown>>(
      "prospects:query:prospect:detail",
      { id: accepted.id },
      viewer,
    );
    expect(detail["name"]).toBe("Max Mustermann");
  });
});
