import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  configuredPiiSubjectKms,
  type SubjectId,
  subjectIdToKey,
} from "@cosmicdrift/kumiko-framework/crypto";
import {
  createEventStoreExecutor,
  createTenantDb,
  type DbRunner,
} from "@cosmicdrift/kumiko-framework/db";
import {
  createSystemUser,
  type EscapeHatchAuditSink,
  EXT_EXTERNAL_RESOURCE,
  EXT_INFRA_RESOURCE,
  EXT_SEARCH_ADAPTER,
  EXT_STORAGE_PROVIDER,
  EXT_TENANT_DATA,
  extensionUsageEscapeHatchReason,
  isTenantDataExtensionHooks,
  isTenantResourceExtensionHooks,
  type Registry,
  type TenantDataHookCtx,
  type TenantDestroyHookResult,
  type TenantId,
  type TenantResourceExtensionName,
} from "@cosmicdrift/kumiko-framework/engine";
import type { FileProviderResolver } from "@cosmicdrift/kumiko-framework/files";
import { createFallbackLogger, type Logger } from "@cosmicdrift/kumiko-framework/logging";
import {
  createEscapeHatchReporter,
  UNATTRIBUTED_ACTOR,
} from "@cosmicdrift/kumiko-framework/pipeline";
import {
  purgeSearchDocumentsForSubject,
  type SearchAdapter,
} from "@cosmicdrift/kumiko-framework/search";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import {
  tenantEntity,
  tenantMembershipEntity,
  tenantMembershipsTable,
  tenantTable,
} from "../tenant/index.js";
import type { TenantDestructionStageName } from "./constants.js";
import { invalidateTenantLifecycleGate } from "./lifecycle-gate.js";

export type DestructionStageCtx = {
  readonly db: DbRunner;
  readonly registry: Registry;
  readonly tenantId: TenantId;
  readonly log?: (message: string) => void;
  // Only threaded through for the "files" stage (EXT_STORAGE_PROVIDER
  // "destroyTenant" hooks) — undefined when no file-provider is wired,
  // which those hooks must treat as "nothing to clean up", not an error.
  readonly fileProviderResolver?: FileProviderResolver;
  // Derived search docs of the tenant record (its name) live in the writer's
  // index, not the destroyed tenant's, so the subject-keys stage purges them.
  readonly searchAdapter?: SearchAdapter;
  // fw#2914 — sourced from the owning job's ctx (_escapeHatchAuditSink,
  // systemUser.id); runTenantDataHooks uses them to attribute+audit any
  // EXT_TENANT_DATA usage's declared escapeHatch.
  readonly escapeHatchAuditSink?: EscapeHatchAuditSink;
  readonly escapeHatchAuditLog?: Logger;
  readonly actor?: string;
  // Epoch ms the stage must hand back by returning { done: false }.
  readonly deadlineAt: number;
};

export type StageRunOutcome = { readonly done: boolean; readonly processed: number };

const STAGE_DONE: StageRunOutcome = { done: true, processed: 0 };

export type DestructionStage = {
  readonly name: TenantDestructionStageName;
  readonly maxAttempts: number;
  readonly run: (ctx: DestructionStageCtx) => Promise<StageRunOutcome>;
};

const tenantCrud = createEventStoreExecutor(tenantTable, tenantEntity, { entityName: "tenant" });
const tenantMembershipCrud = createEventStoreExecutor(
  tenantMembershipsTable,
  tenantMembershipEntity,
  {
    entityName: "tenant-membership",
  },
);

// Every hook still runs each tick (they are idempotent), so a later hook is not
// starved by an earlier one that keeps reporting done:false.
function newOutcomeAccumulator(): {
  add: (result: TenantDestroyHookResult | void) => void;
  outcome: () => StageRunOutcome;
} {
  let allDone = true;
  let processed = 0;
  return {
    add: (result) => {
      if (result?.done === false) allDone = false;
      processed += result?.processed ?? 0;
    },
    outcome: () => ({ done: allDone, processed }),
  };
}

async function runExtensionDestroyHooks(
  registry: Registry,
  extensionName: TenantResourceExtensionName,
  ctx: DestructionStageCtx,
): Promise<StageRunOutcome> {
  const usages = registry.getExtensionUsages(extensionName);
  const total = newOutcomeAccumulator();
  for (const usage of usages) {
    if (!isTenantResourceExtensionHooks(usage.options)) {
      throw new Error(
        `${extensionName} registration for "${usage.entityName}" has no destroy function`,
      );
    }
    total.add(await usage.options.destroyTenant(ctx.tenantId, ctx));
  }
  return total.outcome();
}

async function runTenantDataHooks(ctx: DestructionStageCtx): Promise<StageRunOutcome> {
  const usages = ctx.registry.getExtensionUsages(EXT_TENANT_DATA);
  const total = newOutcomeAccumulator();
  for (const usage of usages) {
    if (!isTenantDataExtensionHooks(usage.options)) {
      throw new Error(
        `${EXT_TENANT_DATA} registration for "${usage.entityName}" has no destroy function`,
      );
    }
    const destroy = usage.options.destroy;
    const reason = extensionUsageEscapeHatchReason(usage);
    const report = createEscapeHatchReporter({
      handler: `${EXT_TENANT_DATA}:${usage.entityName}`,
      tenantId: ctx.tenantId,
      actor: ctx.actor ?? UNATTRIBUTED_ACTOR,
      sink: ctx.escapeHatchAuditSink,
      log: ctx.escapeHatchAuditLog ?? createFallbackLogger("tenant-lifecycle"),
    });
    const hookCtx: TenantDataHookCtx = {
      db: createTenantDb(ctx.db, ctx.tenantId, "tenant", undefined, undefined, undefined, {
        unsafeRaw: reason !== undefined ? { reason } : undefined,
        report,
      }),
      registry: ctx.registry,
      tenantId: ctx.tenantId,
      deadlineAt: ctx.deadlineAt,
      fileProviderResolver: ctx.fileProviderResolver,
      log: ctx.log,
    };
    total.add(await destroy(hookCtx));
  }
  return total.outcome();
}

async function eraseSubjectKeys(ctx: DestructionStageCtx): Promise<StageRunOutcome> {
  const kms = configuredPiiSubjectKms();
  if (!kms) {
    ctx.log?.("[tenant-lifecycle] subject-keys stage skipped: no KMS adapter configured");
    // skip: KMS optional — apps without crypto-shredding still run other destroy stages
    return STAGE_DONE;
  }
  const memberships = await selectMany<{ userId: string }>(ctx.db, tenantMembershipsTable, {
    tenantId: ctx.tenantId,
  });
  const tenantRecordSubject: SubjectId = { kind: "record", entity: "tenant", id: ctx.tenantId };
  const subjects: SubjectId[] = [
    { kind: "tenant", tenantId: ctx.tenantId },
    tenantRecordSubject,
    ...memberships.map((m) => ({ kind: "user" as const, userId: m.userId })),
  ];
  for (const subject of subjects) {
    await kms.eraseKey(subject, {
      requestId: `tenant-lifecycle:destroy:${ctx.tenantId}`,
      eraseReason: "tenant-destroy stage subject-keys",
    });
  }
  if (ctx.searchAdapter) {
    await purgeSearchDocumentsForSubject(
      ctx.db,
      ctx.registry.features,
      ctx.searchAdapter,
      subjectIdToKey(tenantRecordSubject),
      tenantRecordSubject,
    );
  }
  return STAGE_DONE;
}

async function purgeTenantCache(ctx: DestructionStageCtx): Promise<StageRunOutcome> {
  // ponytail: Redis SCAN+DEL is wired when ctx carries a redis client; until
  // then this stage is a documented no-op (no cache layer in test stack).
  ctx.log?.("[tenant-lifecycle] cache stage: no redis client in ctx — skipped");
  return STAGE_DONE;
}

async function tombstoneTenantRow(ctx: DestructionStageCtx): Promise<StageRunOutcome> {
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
  return STAGE_DONE;
}

export const DESTRUCTION_STAGES: readonly DestructionStage[] = [
  {
    name: "external-resources",
    maxAttempts: 3,
    run: (ctx) => runExtensionDestroyHooks(ctx.registry, EXT_EXTERNAL_RESOURCE, ctx),
  },
  {
    name: "search-indices",
    maxAttempts: 3,
    run: (ctx) => runExtensionDestroyHooks(ctx.registry, EXT_SEARCH_ADAPTER, ctx),
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
    run: (ctx) => runExtensionDestroyHooks(ctx.registry, EXT_STORAGE_PROVIDER, ctx),
  },
  {
    name: "infra-resources",
    maxAttempts: 3,
    run: (ctx) => runExtensionDestroyHooks(ctx.registry, EXT_INFRA_RESOURCE, ctx),
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
