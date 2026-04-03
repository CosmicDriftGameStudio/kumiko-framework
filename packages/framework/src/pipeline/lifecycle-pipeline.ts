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
    handlerName: string,
    changes: Record<string, unknown>,
    previous: Readonly<Record<string, unknown>>,
    isNew: boolean,
    context: PipelineContext,
  ): Promise<Record<string, unknown>>;

  runPostSave(handlerName: string, result: SaveContext, context: PipelineContext): Promise<void>;

  runPreDelete(
    handlerName: string,
    payload: DeleteContext,
    context: PipelineContext,
  ): Promise<void>;

  runPostDelete(
    handlerName: string,
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
    async runPreSave(handlerName, changes, previous, isNew, context) {
      let currentChanges = changes;
      const hookContext = { ...context, previous, isNew };

      // Handler hooks (keyed by qualified handler name)
      for (const hook of registry.getPreSaveHooks(handlerName)) {
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

    async runPostSave(handlerName, result, context) {
      const errors: Array<{ name: string; error: unknown }> = [];

      // Handler hooks (keyed by qualified handler name)
      for (const hook of registry.getPostSaveHooks(handlerName)) {
        try {
          await hook(result, context);
        } catch (e) {
          errors.push({ name: `handler:${handlerName}`, error: e });
        }
      }

      // Entity hooks (keyed by entity name from result)
      if (result.entityName) {
        for (const hook of registry.getEntityPostSaveHooks(result.entityName)) {
          try {
            await hook(result, context);
          } catch (e) {
            errors.push({ name: `entity:${result.entityName}`, error: e });
          }
        }
      }

      // System hooks by priority
      if (systemHooks.postSave) {
        for (const sysHook of sortByPriority(systemHooks.postSave)) {
          try {
            await sysHook.fn(result, context);
          } catch (e) {
            errors.push({ name: sysHook.name, error: e });
          }
        }
      }

      if (errors.length > 0) {
        console.error(
          `[lifecycle] postSave errors for ${handlerName}:`,
          errors.map((e) => `${e.name}: ${e.error}`),
        );
      }
    },

    async runPreDelete(handlerName, payload, context) {
      // Handler hooks
      for (const hook of registry.getPreDeleteHooks(handlerName)) {
        await hook(payload, context);
      }

      // Entity hooks
      if (payload.entityName) {
        for (const hook of registry.getEntityPreDeleteHooks(payload.entityName)) {
          await hook(payload, context);
        }
      }

      // System hooks
      if (systemHooks.preDelete) {
        for (const sysHook of sortByPriority(systemHooks.preDelete)) {
          await sysHook.fn(payload, context);
        }
      }
    },

    async runPostDelete(handlerName, payload, context) {
      const errors: Array<{ name: string; error: unknown }> = [];

      // Handler hooks
      for (const hook of registry.getPostDeleteHooks(handlerName)) {
        try {
          await hook(payload, context);
        } catch (e) {
          errors.push({ name: `handler:${handlerName}`, error: e });
        }
      }

      // Entity hooks
      if (payload.entityName) {
        for (const hook of registry.getEntityPostDeleteHooks(payload.entityName)) {
          try {
            await hook(payload, context);
          } catch (e) {
            errors.push({ name: `entity:${payload.entityName}`, error: e });
          }
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
          `[lifecycle] postDelete errors for ${handlerName}:`,
          errors.map((e) => `${e.name}: ${e.error}`),
        );
      }
    },
  };
}
