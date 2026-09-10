// setupTestStack runs the ownership boot-guards (fw#2639 unqualified
// where-fragments, fw#2626 where-rules on the write path). Before this, only
// the prod boot ran validateBoot, so a feature with a broken access map came
// through every test suite green and failed on the first real deploy.

import { describe, expect, test } from "bun:test";
import {
  createEntity,
  createTextField,
  defineEntityQueryHandler,
  defineFeature,
  from,
} from "../../engine";
import type { WhereRule } from "../../engine/types";
import { setupTestStack } from "../test-stack";

// Bare `owner_id` inside the subquery binds to fwbootguard_shares, not to the
// outer memo table — the predicate collapses into a tautology and grants every
// row. This is the exact fail-open shape fw#2639 lints for.
const unqualifiedReadRule: WhereRule = {
  kind: "where",
  where: (user, ctx) => ({
    sqlText: `${ctx.tableName}.id IN (SELECT memo_id FROM fwbootguard_shares WHERE owner_id = $${ctx.paramStart})`,
    params: [user.id],
  }),
};

const qualifiedWriteRule: WhereRule = {
  kind: "where",
  where: (user, ctx) => ({
    sqlText: `${ctx.tableName}.owner_id = $${ctx.paramStart}`,
    params: [user.id],
  }),
};

function memoEntity(access: Parameters<typeof createEntity>[0]["access"]) {
  return createEntity({
    table: "fwbootguard_memos",
    fields: {
      ownerId: createTextField({ required: true }),
      title: createTextField({ required: true }),
    },
    ...(access ? { access } : {}),
  });
}

function featureWith(access: Parameters<typeof createEntity>[0]["access"]) {
  const entity = memoEntity(access);
  return defineFeature("fwbootguard", (r) => {
    r.entity("memo", entity);
    r.queryHandler(
      defineEntityQueryHandler("memo:detail", entity, { access: { roles: ["Member"] } }),
    );
  });
}

describe("setupTestStack — ownership boot-guards", () => {
  test("rejects an unqualified where-fragment on access.read (fw#2639)", async () => {
    const promise = setupTestStack({
      features: [featureWith({ read: { Member: unqualifiedReadRule } })],
    });
    await expect(promise).rejects.toThrow(
      /references column "owner_id" unqualified inside a subquery/,
    );
    await expect(promise).rejects.toThrow(/entity "memo"\.access\.read/);
    await expect(promise).rejects.toThrow(/role "Member", feature: "fwbootguard"/);
  });

  test("rejects a where-rule on access.write (fw#2626)", async () => {
    const promise = setupTestStack({
      features: [featureWith({ read: { Member: "all" }, write: { Member: qualifiedWriteRule } })],
    });
    await expect(promise).rejects.toThrow(/entity "memo"\.access\.write/);
    await expect(promise).rejects.toThrow(/feature: "fwbootguard"/);
  });

  test("a qualified read-rule still boots", async () => {
    const stack = await setupTestStack({
      features: [featureWith({ read: { Member: qualifiedWriteRule } })],
    });
    expect(stack.registry.getEntity("memo")?.table).toBe("fwbootguard_memos");
    await stack.cleanup();
  });

  // The role and claim corpora are whole-app facts. A stack that mounts a
  // deliberate subset cannot answer them, so those two checks stay out of the
  // test-stack path while the subset-invariant where-lint keeps firing on the
  // very same map. Without this test, the next "fix" to collectKnownRoles
  // quietly reinstates the false positives it removed.
  test("a subset stack skips the cross-feature checks but still lints where-fragments", async () => {
    const undeclaredRefs = {
      Auditor: "all",
      Reviewer: from("claim:fwbootguardelsewhere:teamId", "ownerId"),
    } as const;

    const stack = await setupTestStack({
      features: [featureWith({ read: { ...undeclaredRefs, Member: "all" } })],
    });
    expect(stack.registry.getEntity("memo")?.table).toBe("fwbootguard_memos");
    await stack.cleanup();

    await expect(
      setupTestStack({
        features: [featureWith({ read: { ...undeclaredRefs, Member: unqualifiedReadRule } })],
      }),
    ).rejects.toThrow(/references column "owner_id" unqualified inside a subquery/);
  });
});
