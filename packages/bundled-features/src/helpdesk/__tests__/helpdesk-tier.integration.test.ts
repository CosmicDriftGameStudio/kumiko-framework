import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { SessionUser } from "@cosmicdrift/kumiko-framework/engine";
import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-testing/helpers";
import { TierEngineHandlers } from "../../tier-engine/web/constants.ts";
import { HelpdeskHandlers } from "../web/constants.ts";
import { loadRequests, seedAdmin, seedReporter } from "./helpdesk-helpers.ts";
import {
  createHelpdeskTestStack,
  type HelpdeskTestStack,
  resetHelpdeskTestState,
} from "./helpdesk-test-stack.ts";

let ctx: HelpdeskTestStack;
let admin: SessionUser;

beforeAll(async () => {
  resetPiiSubjectKmsForTests();
  ctx = await createHelpdeskTestStack({}, { tierEngine: true });
});

afterAll(async () => {
  ctx.telegram.stop();
  await ctx.stack.cleanup();
});

beforeEach(async () => {
  await resetHelpdeskTestState(ctx);
  admin = await seedAdmin(ctx.stack, "admin1@example.com");
});

describe("helpdesk with tier-engine mounted", () => {
  test("a report carries the display name of the reporter's plan", async () => {
    const reporter = await seedReporter(ctx.stack, "rita@example.com");
    await ctx.stack.http.writeOk(
      TierEngineHandlers.setTenantTier,
      { tenantId: reporter.tenantId, tier: "team" },
      admin,
    );
    await ctx.stack.http.writeOk(
      HelpdeskHandlers.report,
      { kind: "question", subject: "Plan", message: "Which plan am I on?" },
      reporter,
    );

    const [row] = await loadRequests(ctx.stack);
    expect(row?.["reporterTenantPlan"]).toBe("Team");
  });

  test("a tenant without a tier assignment leaves the plan empty", async () => {
    const reporter = await seedReporter(ctx.stack, "rita@example.com");
    await ctx.stack.http.writeOk(
      HelpdeskHandlers.report,
      { kind: "question", subject: "Plan", message: "No plan yet." },
      reporter,
    );

    const [row] = await loadRequests(ctx.stack);
    expect(row?.["reporterTenantPlan"] ?? null).toBeNull();
  });
});
