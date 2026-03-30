import type {
  DeleteContext,
  PipelineContext,
  PostDeleteHookFn,
  PostSaveHookFn,
  PreDeleteHookFn,
  PreSaveHookFn,
  Registry,
  SaveContext,
} from "../engine/types";

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

export type LifecyclePipeline = {
  runPreSave(
    entityName: string,
    changes: Record<string, unknown>,
    previous: Readonly<Record<string, unknown>>,
    isNew: boolean,
    context: PipelineContext,
  ): Promise<Record<string, unknown>>;

  runPostSave(entityName: string, result: SaveContext, context: PipelineContext): Promise<void>;

  runPreDelete(entityName: string, payload: DeleteContext, context: PipelineContext): Promise<void>;

  runPostDelete(
    entityName: string,
    payload: DeleteContext,
    context: PipelineContext,
  ): Promise<void>;
};

export function createLifecyclePipeline(
  registry: Registry,
  systemHooks: SystemHooks = {},
): LifecyclePipeline {
  function sortByPriority<T extends { priority: number }>(hooks: readonly T[]): T[] {
    return [...hooks].sort((a, b) => a.priority - b.priority);
  }

  return {
    async runPreSave(entityName, changes, previous, isNew, context) {
      let currentChanges = changes;
      const hookContext = { ...context, previous, isNew };

      // Feature hooks first (priority 0-99 implicitly)
      for (const hook of registry.getPreSaveHooks(entityName)) {
        currentChanges = await hook(currentChanges, hookContext);
      }

      // System hooks by priority
      if (systemHooks.preSave) {
        for (const sysHook of sortByPriority(systemHooks.preSave)) {
          currentChanges = await sysHook.fn(currentChanges, hookContext);
        }
      }

      return currentChanges;
    },

    async runPostSave(entityName, result, context) {
      const errors: Array<{ name: string; error: unknown }> = [];

      // Feature hooks first
      for (const hook of registry.getPostSaveHooks(entityName)) {
        try {
          await hook(result, context);
        } catch (e) {
          errors.push({ name: `feature:${entityName}`, error: e });
        }
      }

      // System hooks by priority — don't block on errors
      if (systemHooks.postSave) {
        for (const sysHook of sortByPriority(systemHooks.postSave)) {
          try {
            await sysHook.fn(result, context);
          } catch (e) {
            errors.push({ name: sysHook.name, error: e });
          }
        }
      }

      // Log errors but don't throw — DB write is already committed
      if (errors.length > 0) {
        console.error(
          `[lifecycle] postSave errors for ${entityName}#${result.id}:`,
          errors.map((e) => `${e.name}: ${e.error}`),
        );
      }
    },

    async runPreDelete(entityName, payload, context) {
      // Feature hooks
      for (const hook of registry.getPreDeleteHooks(entityName)) {
        await hook(payload, context);
      }

      // System hooks
      if (systemHooks.preDelete) {
        for (const sysHook of sortByPriority(systemHooks.preDelete)) {
          await sysHook.fn(payload, context);
        }
      }
    },

    async runPostDelete(entityName, payload, context) {
      const errors: Array<{ name: string; error: unknown }> = [];

      // Feature hooks
      for (const hook of registry.getPostDeleteHooks(entityName)) {
        try {
          await hook(payload, context);
        } catch (e) {
          errors.push({ name: `feature:${entityName}`, error: e });
        }
      }

      // System hooks
      if (systemHooks.postDelete) {
        for (const sysHook of sortByPriority(systemHooks.postDelete)) {
          try {
            await sysHook.fn(payload, context);
          } catch (e) {
            errors.push({ name: sysHook.name, error: e });
          }
        }
      }

      if (errors.length > 0) {
        console.error(
          `[lifecycle] postDelete errors for ${entityName}#${payload.id}:`,
          errors.map((e) => `${e.name}: ${e.error}`),
        );
      }
    },
  };
}
