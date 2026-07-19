import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { configuredPiiSubjectKms, type SubjectId } from "@cosmicdrift/kumiko-framework/crypto";
import {
  createEventStoreExecutor,
  createTenantDb,
  type DbRunner,
} from "@cosmicdrift/kumiko-framework/db";
import {
  createSystemUser,
  EXT_EXTERNAL_RESOURCE,
  EXT_INFRA_RESOURCE,
  EXT_SEARCH_ADAPTER,
  EXT_STORAGE_PROVIDER,
  EXT_TENANT_DATA,
  type Registry,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import {
  tenantEntity,
  tenantMembershipEntity,
  tenantMembershipsTable,
  tenantTable,
} from "../tenant";
import type { TenantDestructionStageName } from "./constants";
import { invalidateTenantLifecycleGate } from "./lifecycle-gate";

export type DestructionStageCtx = {
  readonly db: DbRunner;
  readonly registry: Registry;
  readonly tenantId: TenantId;
  readonly log?: (message: string) => void;
};

export type DestructionStage = {
  readonly name: TenantDestructionStageName;
  readonly maxAttempts: number;
  readonly run: (ctx: DestructionStageCtx) => Promise<void>;
};

const tenantCrud = createEventStoreExecutor(tenantTable, tenantEntity, { entityName: "tenant" });
const tenantMembershipCrud = createEventStoreExecutor(
  tenantMembershipsTable,
  tenantMembershipEntity,
  {
    entityName: "tenant-membership",
  },
);

async function runExtensionDestroyHooks(
  registry: Registry,
  extensionName: string,
  hookKey: "destroyTenant",
  ctx: DestructionStageCtx,
): Promise<void> {
  const usages = registry.getExtensionUsages(extensionName);
  for (const usage of usages) {
    const hook = usage.options?.[hookKey];
    if (typeof hook !== "function") continue;
    await (hook as (tenantId: TenantId, hookCtx: DestructionStageCtx) => Promise<void>)(
      ctx.tenantId,
      ctx,
    );
  }
}

async function runTenantDataHooks(ctx: DestructionStageCtx): Promise<void> {
  const usages = ctx.registry.getExtensionUsages(EXT_TENANT_DATA);
  for (const usage of usages) {
    const destroy = usage.options?.["destroy"] as
      | ((ctx: DestructionStageCtx) => Promise<void>)
      | undefined;
    if (!destroy) continue;
    await destroy(ctx);
  }
}

async function eraseSubjectKeys(ctx: DestructionStageCtx): Promise<void> {
  const kms = configuredPiiSubjectKms();
  if (!kms) {
    ctx.log?.("[tenant-lifecycle] subject-keys stage skipped: no KMS adapter configured");
    // skip: KMS optional — apps without crypto-shredding still run other destroy stages
    return;
  }
  const memberships = await selectMany<{ userId: string }>(ctx.db, tenantMembershipsTable, {
    tenantId: ctx.tenantId,
  });
  const subjects: SubjectId[] = [
    { kind: "tenant", tenantId: ctx.tenantId },
    ...memberships.map((m) => ({ kind: "user" as const, userId: m.userId })),
  ];
  for (const subject of subjects) {
    await kms.eraseKey(subject, {
      requestId: `tenant-lifecycle:destroy:${ctx.tenantId}`,
      eraseReason: "tenant-destroy stage subject-keys",
    });
  }
}

async function purgeTenantCache(ctx: DestructionStageCtx): Promise<void> {
  // ponytail: Redis SCAN+DEL is wired when ctx carries a redis client; until
  // then this stage is a documented no-op (no cache layer in test stack).
  ctx.log?.("[tenant-lifecycle] cache stage: no redis client in ctx — skipped");
}

async function tombstoneTenantRow(ctx: DestructionStageCtx): Promise<void> {
  const now = getTemporal().Now.instant();
  const user = createSystemUser(ctx.tenantId);
  const db = createTenantDb(ctx.db, ctx.tenantId, "system");
  // Per-row forget() through the executor, not a bulk deleteMany: memberships
  // are an ES-managed projection (add/remove/update-roles all go through
  // tenantMembershipCrud), so a store table write here is eventless — a future
  // projection rebuild would replay the historical add-member events and
  // resurrect rows this stage removed. forget() (Art.17 hard-purge) keeps the
  // erasure rebuild-safe and gives each membership its own audit event.
  const memberships = await selectMany<{ id: string }>(ctx.db, tenantMembershipsTable, {
    tenantId: ctx.tenantId,
  });
  for (const membership of memberships) {
    const result = await tenantMembershipCrud.forget({ id: membership.id }, user, db);
    // executor writes return {isSuccess:false} on failure, they don't throw —
    // a silently-discarded result here would report this stage "succeeded"
    // while membership PII survives. Throw so the pipeline's retry/abandon
    // handling (runNextDestructionStage) sees it instead.
    if (!result.isSuccess) {
      throw new Error(
        `tenant-lifecycle: failed to forget membership ${membership.id} for tenant ${ctx.tenantId}: ${result.error.message}`,
      );
    }
  }
  await tenantCrud.update(
    {
      id: ctx.tenantId,
      changes: {
        status: "destroyed",
        destroyedAt: now,
        isEnabled: false,
      },
    },
    user,
    db,
    { skipOptimisticLock: true },
  );
  invalidateTenantLifecycleGate(ctx.tenantId);
}

export const DESTRUCTION_STAGES: readonly DestructionStage[] = [
  {
    name: "external-resources",
    maxAttempts: 3,
    run: (ctx) =>
      runExtensionDestroyHooks(ctx.registry, EXT_EXTERNAL_RESOURCE, "destroyTenant", ctx),
  },
  {
    name: "search-indices",
    maxAttempts: 3,
    run: (ctx) => runExtensionDestroyHooks(ctx.registry, EXT_SEARCH_ADAPTER, "destroyTenant", ctx),
  },
  {
    name: "cache",
    maxAttempts: 1,
    run: purgeTenantCache,
  },
  {
    name: "app-data",
    maxAttempts: 3,
    run: runTenantDataHooks,
  },
  {
    name: "subject-keys",
    maxAttempts: 3,
    run: eraseSubjectKeys,
  },
  {
    name: "files",
    maxAttempts: 3,
    run: (ctx) =>
      runExtensionDestroyHooks(ctx.registry, EXT_STORAGE_PROVIDER, "destroyTenant", ctx),
  },
  {
    name: "infra-resources",
    maxAttempts: 3,
    run: (ctx) => runExtensionDestroyHooks(ctx.registry, EXT_INFRA_RESOURCE, "destroyTenant", ctx),
  },
  {
    name: "tenant-row",
    maxAttempts: 1,
    run: tombstoneTenantRow,
  },
];

export function pickNextStage(
  completedStages: ReadonlySet<string>,
  abandonedStages: ReadonlySet<string>,
): DestructionStage | null {
  if (abandonedStages.size > 0) return null;
  for (const stage of DESTRUCTION_STAGES) {
    if (completedStages.has(stage.name)) continue;
    return stage;
  }
  return null;
}

export function isDestructionPipelineComplete(completedStages: ReadonlySet<string>): boolean {
  return DESTRUCTION_STAGES.every((stage) => completedStages.has(stage.name));
}
