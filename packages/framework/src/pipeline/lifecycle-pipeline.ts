import type {
  AppContext,
  DeleteContext,
  HookPhase,
  PostDeleteHookFn,
  PostSaveHookFn,
  PreDeleteHookFn,
  PreSaveHookFn,
  Registry,
  SaveContext,
} from "../engine/types";
import { HookPhases } from "../engine/types";
import type { EventDedup } from "./event-dedup";

export type SystemHookDef<TFn> = {
  readonly name: string;
  readonly priority: number;
  readonly fn: TFn;
  // Default: afterCommit (same as user-registered hooks).
  // Set to "inTransaction" for DB-based side-effects (e.g. audit rows)
  // that must roll back with the transaction.
  readonly phase?: HookPhase;
};

export type SystemHooks = {
  readonly preSave?: readonly SystemHookDef<PreSaveHookFn>[];
  readonly postSave?: readonly SystemHookDef<PostSaveHookFn>[];
  readonly preDelete?: readonly SystemHookDef<PreDeleteHookFn>[];
  readonly postDelete?: readonly SystemHookDef<PostDeleteHookFn>[];
};

export type LifecycleHooks = {
  runPreSave(
    handlerName: string,
    changes: Record<string, unknown>,
    previous: Readonly<Record<string, unknown>>,
    isNew: boolean,
    context: AppContext,
  ): Promise<Record<string, unknown>>;

  // Phase-aware: pass "inTransaction" to run only in-tx hooks during a batch
  // transaction, then "afterCommit" after the transaction commits.
  // Omitting phase runs all hooks (used by legacy call sites — to be removed).
  runPostSave(
    handlerName: string,
    result: SaveContext,
    context: AppContext,
    phase?: HookPhase,
  ): Promise<void>;

  runPreDelete(handlerName: string, payload: DeleteContext, context: AppContext): Promise<void>;

  runPostDelete(
    handlerName: string,
    payload: DeleteContext,
    context: AppContext,
    phase?: HookPhase,
  ): Promise<void>;
};

export type LifecycleOptions = {
  eventDedup?: EventDedup;
};

export function createLifecycleHooks(
  registry: Registry,
  systemHooks: SystemHooks = {},
  options: LifecycleOptions = {},
): LifecycleHooks {
  const { eventDedup } = options;

  function sortByPriority<T extends { priority: number }>(hooks: readonly T[]): T[] {
    return [...hooks].sort((a, b) => a.priority - b.priority);
  }

  // Shared hook execution: runs handler hooks → entity hooks → system hooks.
  //
  // Error handling depends on hookPhase:
  //   - inTransaction: errors THROW (roll back transaction)
  //   - afterCommit: errors are collected + logged (best-effort)
  //
  // Event dedup is only applied in afterCommit phase, because:
  //   - the key must not be consumed if the transaction later rolls back
  //   - in-tx hooks run once per commit, dedup there is redundant
  async function runHookSet<TPayload>(opts: {
    handlerName: string;
    payload: TPayload;
    context: AppContext;
    entityName: string | undefined;
    getHandlerHooks: (name: string) => readonly ((p: TPayload, c: AppContext) => Promise<void>)[];
    getEntityHooks: (name: string) => readonly ((p: TPayload, c: AppContext) => Promise<void>)[];
    systemHookDefs:
      | readonly SystemHookDef<(p: TPayload, c: AppContext) => Promise<void>>[]
      | undefined;
    phaseLabel: string;
    hookPhase: HookPhase;
  }): Promise<void> {
    const throwOnError = opts.hookPhase === HookPhases.inTransaction;

    // Event dedup: only in afterCommit (see comment above).
    //
    // SEMANTICS: pre-claim dedup = "at-most-once". tryAcquire is called before
    // the hook runs, so if the hook crashes mid-execution, the retry sees
    // `acquired=false` and skips the rest. This is the right trade-off for
    // best-effort side-effects like Search Index, SSE broadcast, Audit — a
    // missed hook is preferable to a duplicate notification. Features that
    // need at-least-once semantics must not rely on this path; use the
    // transactional outbox (ctx.emit) instead, which retries until an ack.
    if (eventDedup && opts.hookPhase === HookPhases.afterCommit) {
      const eventId = buildEventId(opts.handlerName, opts.payload, opts.phaseLabel);
      if (eventId) {
        const acquired = await eventDedup.tryAcquire(eventId);
        if (!acquired) {
          opts.context.log?.debug(
            `${opts.phaseLabel}: skipping ${opts.handlerName} — event ${eventId} already processed (dedup)`,
          );
          return;
        }
      } else {
        // Missing id on a save/delete payload is unexpected — CrudExecutor
        // always returns one. Log so we can spot framework/feature bugs where
        // a handler emits a non-standard LifecycleResult and accidentally
        // bypasses dedup.
        opts.context.log?.warn(
          `${opts.phaseLabel}: ${opts.handlerName} has no dedup id (payload missing \`id\`) — hook may run multiple times on retry`,
        );
      }
    }

    const errors: Array<{ name: string; error: unknown }> = [];

    for (const hook of opts.getHandlerHooks(opts.handlerName)) {
      try {
        await hook(opts.payload, opts.context);
      } catch (e) {
        if (throwOnError) throw e;
        errors.push({ name: `handler:${opts.handlerName}`, error: e });
      }
    }

    if (opts.entityName) {
      for (const hook of opts.getEntityHooks(opts.entityName)) {
        try {
          await hook(opts.payload, opts.context);
        } catch (e) {
          if (throwOnError) throw e;
          errors.push({ name: `entity:${opts.entityName}`, error: e });
        }
      }
    }

    if (opts.systemHookDefs) {
      for (const sysHook of sortByPriority(opts.systemHookDefs)) {
        const sysHookPhase = sysHook.phase ?? HookPhases.afterCommit;
        if (sysHookPhase !== opts.hookPhase) continue;
        try {
          await sysHook.fn(opts.payload, opts.context);
        } catch (e) {
          if (throwOnError) throw e;
          errors.push({ name: sysHook.name, error: e });
        }
      }
    }

    if (errors.length > 0) {
      const log = opts.context.log;
      const msg = `${opts.phaseLabel} errors for ${opts.handlerName}`;
      const details = errors.map((e) => `${e.name}: ${e.error}`);
      if (log) {
        log.error(msg, { errors: details });
      } else {
        console.error(`[lifecycle] ${msg}:`, details);
      }
    }
  }

  return {
    async runPreSave(handlerName, changes, previous, isNew, context) {
      let currentChanges = changes;
      const hookContext = { ...context, previous, isNew };

      for (const hook of registry.getPreSaveHooks(handlerName)) {
        currentChanges = await hook(currentChanges, hookContext);
      }

      if (systemHooks.preSave) {
        for (const sysHook of sortByPriority(systemHooks.preSave)) {
          currentChanges = await sysHook.fn(currentChanges, hookContext);
        }
      }

      return currentChanges;
    },

    async runPostSave(handlerName, result, context, phase = HookPhases.afterCommit) {
      await runHookSet({
        handlerName,
        payload: result,
        context,
        entityName: result.entityName,
        getHandlerHooks: (n) => registry.getPostSaveHooks(n, phase),
        getEntityHooks: (n) => registry.getEntityPostSaveHooks(n, phase),
        systemHookDefs: systemHooks.postSave,
        phaseLabel: `postSave:${phase}`,
        hookPhase: phase,
      });
    },

    async runPreDelete(handlerName, payload, context) {
      // preDelete hooks run in-transaction and throw on failure (not best-effort).
      // They're used to check invariants before delete, so phase filter is "inTransaction".
      for (const hook of registry.getPreDeleteHooks(handlerName, HookPhases.inTransaction)) {
        await hook(payload, context);
      }

      if (payload.entityName) {
        for (const hook of registry.getEntityPreDeleteHooks(
          payload.entityName,
          HookPhases.inTransaction,
        )) {
          await hook(payload, context);
        }
      }

      if (systemHooks.preDelete) {
        for (const sysHook of sortByPriority(systemHooks.preDelete)) {
          const sysHookPhase = sysHook.phase ?? HookPhases.inTransaction;
          if (sysHookPhase !== HookPhases.inTransaction) continue;
          await sysHook.fn(payload, context);
        }
      }
    },

    async runPostDelete(handlerName, payload, context, phase = HookPhases.afterCommit) {
      await runHookSet({
        handlerName,
        payload,
        context,
        entityName: payload.entityName,
        getHandlerHooks: (n) => registry.getPostDeleteHooks(n, phase),
        getEntityHooks: (n) => registry.getEntityPostDeleteHooks(n, phase),
        systemHookDefs: systemHooks.postDelete,
        phaseLabel: `postDelete:${phase}`,
        hookPhase: phase,
      });
    },
  };
}

// Build a unique eventId from handler + entity identity + version + phase.
// version makes it unique per write (incremented on every update).
// Exported for unit tests — the warn-log path (null return) is otherwise
// unreachable through the normal LifecycleResult flow.
export function buildEventId(handlerName: string, payload: unknown, phase: string): string | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  const id = p["id"] as number | undefined;
  if (!id) return null;
  const data = p["data"] as Record<string, unknown> | undefined;
  const version = data?.["version"] as number | undefined;
  return `${handlerName}:${id}:${version ?? 0}:${phase}`;
}
