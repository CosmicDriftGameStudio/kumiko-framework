import { z } from "zod";
import { buildInsertSchema, buildUpdateSchema } from "./schema-builder";
import type { AccessRule, EntityDefinition, QueryHandlerDef, WriteHandlerDef } from "./types";

type CrudOptions = {
  access?: AccessRule;
};

type CrudHandlers = {
  writeHandlers: Record<string, WriteHandlerDef>;
  queryHandlers: Record<string, QueryHandlerDef>;
};

const stubWrite = async () => ({ isSuccess: true as const, data: null });
const stubQuery = async () => null;

export function buildCrudHandlers(
  entityName: string,
  entity: EntityDefinition,
  options?: CrudOptions,
): CrudHandlers {
  const insertSchema = buildInsertSchema(entity);
  const updateSchema = buildUpdateSchema(entity);

  const accessSpread = options?.access ? { access: options.access } : {};

  const writeHandlers: Record<string, WriteHandlerDef> = {
    [`${entityName}:create`]: {
      name: `${entityName}:create`,
      schema: insertSchema,
      handler: stubWrite,
      ...accessSpread,
    },
    [`${entityName}:update`]: {
      name: `${entityName}:update`,
      schema: z.object({
        id: z.number(),
        changes: updateSchema,
      }),
      handler: stubWrite,
      ...accessSpread,
    },
    [`${entityName}:delete`]: {
      name: `${entityName}:delete`,
      schema: z.object({ id: z.number() }),
      handler: stubWrite,
      ...accessSpread,
    },
  };

  const queryHandlers: Record<string, QueryHandlerDef> = {
    [`${entityName}:list`]: {
      name: `${entityName}:list`,
      schema: z.object({
        cursor: z.string().optional(),
        limit: z.number().optional(),
        search: z.string().optional(),
      }),
      handler: stubQuery,
      ...accessSpread,
    },
    [`${entityName}:detail`]: {
      name: `${entityName}:detail`,
      schema: z.object({ id: z.number() }),
      handler: stubQuery,
      ...accessSpread,
    },
  };

  return { writeHandlers, queryHandlers };
}
