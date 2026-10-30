import type { NamedListFilterCondition } from "@cosmicdrift/kumiko-types/named-list-filters";
import { AccessDeniedError, ValidationError } from "../errors/index.ts";
import { hasAccess } from "./access.ts";
import type { HandlerContext, SessionUser } from "./types/index.ts";

export async function resolveNamedListFilters(
  ctx: HandlerContext,
  user: SessionUser,
  entityName: string,
  name: string,
): Promise<readonly NamedListFilterCondition[]> {
  const registered = ctx.registry.getEntity(entityName)?.namedFilters ?? {};
  const def = Object.hasOwn(registered, name) ? registered[name] : undefined;
  if (def === undefined) {
    throw new ValidationError({
      fields: [
        {
          path: "namedFilter",
          code: "unknown_named_filter",
          i18nKey: "errors.validation.invalid_value",
          params: { entity: entityName, namedFilter: name },
        },
      ],
    });
  }
  if (def.access !== undefined && !hasAccess(user, def.access)) {
    throw new AccessDeniedError();
  }
  const conditions = await def.filters({ ctx, user, now: ctx.tz.now() });
  const entityFields = ctx.registry.getEntity(entityName)?.fields ?? {};
  for (const condition of conditions) {
    // Fail closed: a condition on a non-column is dropped by the list filter and would widen the queue.
    if (condition.field !== "id" && !Object.hasOwn(entityFields, condition.field)) {
      throw new Error(
        `Named filter "${name}" of entity "${entityName}" filters on unknown field "${condition.field}".`,
      );
    }
  }
  return conditions;
}
