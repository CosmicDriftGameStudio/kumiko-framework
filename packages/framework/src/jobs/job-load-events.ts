import type { TenantDb } from "../db/tenant-db.ts";
import { tenantDbRunner } from "../db/tenant-db-runner.ts";
import type { HandlerEvents, Registry } from "../engine/types/index.ts";
import { InternalError } from "../errors/index.ts";
import {
  loadUpcastedAggregate,
  loadUpcastedEventsByTypes,
} from "../pipeline/handler-context-events.ts";

type JobLoadEventsInput = {
  readonly registry: Registry;
  readonly jobDb: TenantDb | undefined;
  readonly tenantId: string;
  readonly jobName: string;
};

export function createJobLoadEventsByTypes(
  input: JobLoadEventsInput,
): HandlerEvents["loadByTypes"] {
  const { registry, jobDb, tenantId, jobName } = input;
  return async (args) => {
    if (jobDb === undefined) {
      throw new InternalError({
        message: `Job ${jobName}: ctx.events.loadByTypes needs a tenant db`,
      });
    }
    return loadUpcastedEventsByTypes({ db: tenantDbRunner(jobDb), registry, tenantId }, args);
  };
}

export function createJobLoadEvents(input: JobLoadEventsInput): HandlerEvents["load"] {
  const { registry, jobDb, tenantId, jobName } = input;
  return async (aggregateId, options) => {
    if (jobDb === undefined) {
      throw new InternalError({ message: `Job ${jobName}: ctx.events.load needs a tenant db` });
    }
    return loadUpcastedAggregate(
      { db: tenantDbRunner(jobDb), registry, tenantId },
      aggregateId,
      options,
    );
  };
}
