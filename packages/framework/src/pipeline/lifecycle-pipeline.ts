import type {
  AppContext,
  DeleteContext,
  PostDeleteHookFn,
  PostSaveHookFn,
  PreDeleteHookFn,
  PreSaveHookFn,
  Registry,
  SaveContext,
} from "../engine/types";
import type { EventDedup } from "./event-dedup";

export type SystemHookDef<TFn> = {
  readonly name: string;
  readonly priority: number;
  readonly fn: TFn;
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

  runPostSave(handlerName: string, result: SaveContext, context: AppContext): Promise<void>;

  runPreDelete(handlerName: string, payload: DeleteContext, context: AppContext): Promise<void>;

  runPostDelete(handlerName: string, payload: DeleteContext, context: AppContext): Promise<void>;
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
  // Collects errors instead of throwing (post-hooks are best-effort).
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
    phase: string;
  }): Promise<void> {
    // Event dedup: skip entire hook set if already processed
    if (eventDedup) {
      const eventId = buildEventId(opts.handlerName, opts.payload, opts.phase);
      if (eventId) {
        const acquired = await eventDedup.tryAcquire(eventId);
        if (!acquired) return;
      }
    }

    const errors: Array<{ name: string; error: unknown }> = [];

    for (const hook of opts.getHandlerHooks(opts.handlerName)) {
      try {
        await hook(opts.payload, opts.context);
      } catch (e) {
        errors.push({ name: `handler:${opts.handlerName}`, error: e });
      }
    }

    if (opts.entityName) {
      for (const hook of opts.getEntityHooks(opts.entityName)) {
        try {
          await hook(opts.payload, opts.context);
        } catch (e) {
          errors.push({ name: `entity:${opts.entityName}`, error: e });
        }
      }
    }

    if (opts.systemHookDefs) {
      for (const sysHook of sortByPriority(opts.systemHookDefs)) {
        try {
          await sysHook.fn(opts.payload, opts.context);
        } catch (e) {
          errors.push({ name: sysHook.name, error: e });
        }
      }
    }

    if (errors.length > 0) {
      console.error(
        `[lifecycle] ${opts.phase} errors for ${opts.handlerName}:`,
        errors.map((e) => `${e.name}: ${e.error}`),
      );
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

    async runPostSave(handlerName, result, context) {
      await runHookSet({
        handlerName,
        payload: result,
        context,
        entityName: result.entityName,
        getHandlerHooks: (n) => registry.getPostSaveHooks(n),
        getEntityHooks: (n) => registry.getEntityPostSaveHooks(n),
        systemHookDefs: systemHooks.postSave,
        phase: "postSave",
      });
    },

    async runPreDelete(handlerName, payload, context) {
      // preDelete hooks throw on failure (not best-effort)
      for (const hook of registry.getPreDeleteHooks(handlerName)) {
        await hook(payload, context);
      }

      if (payload.entityName) {
        for (const hook of registry.getEntityPreDeleteHooks(payload.entityName)) {
          await hook(payload, context);
        }
      }

      if (systemHooks.preDelete) {
        for (const sysHook of sortByPriority(systemHooks.preDelete)) {
          await sysHook.fn(payload, context);
        }
      }
    },

    async runPostDelete(handlerName, payload, context) {
      await runHookSet({
        handlerName,
        payload,
        context,
        entityName: payload.entityName,
        getHandlerHooks: (n) => registry.getPostDeleteHooks(n),
        getEntityHooks: (n) => registry.getEntityPostDeleteHooks(n),
        systemHookDefs: systemHooks.postDelete,
        phase: "postDelete",
      });
    },
  };
}

// Build a unique eventId from handler + entity identity + version + phase.
// version makes it unique per write (incremented on every update).
function buildEventId(handlerName: string, payload: unknown, phase: string): string | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  const id = p["id"] as number | undefined;
  if (!id) return null;
  const data = p["data"] as Record<string, unknown> | undefined;
  const version = data?.["version"] as number | undefined;
  return `${handlerName}:${id}:${version ?? 0}:${phase}`;
}
