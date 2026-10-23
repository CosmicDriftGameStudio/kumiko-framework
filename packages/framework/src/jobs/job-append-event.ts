import type { TenantDb } from "../db/tenant-db.ts";
import { tenantDbWriteRunner } from "../db/tenant-db-runner.ts";
import { runInOwnTransaction } from "../db/tenant-db-scoped-rebind.ts";
import type {
  AppendEventArgs,
  AppendEventFn,
  Registry,
  SessionUser,
} from "../engine/types/index.ts";
import { InternalError } from "../errors/index.ts";
import { appendDomainEventCore } from "../pipeline/append-event-core.ts";
import { asTypedAppendEventFn } from "../pipeline/typed-append-event.ts";

const CALL_SITE_LABEL = "job ctx.events.append";

type JobAppendEventInput = {
  readonly registry: Registry;
  readonly jobDb: TenantDb | undefined;
  readonly tenantId: string;
  readonly systemUser: SessionUser;
  readonly jobName: string;
};

export function createJobAppendEvent(input: JobAppendEventInput): AppendEventFn {
  const { registry, jobDb, tenantId, systemUser, jobName } = input;
  return asTypedAppendEventFn(async (args: AppendEventArgs) => {
    if (jobDb === undefined) {
      throw new InternalError({
        message: `Job ${jobName}: ctx.events.append needs a tenant db`,
      });
    }
    const callerFeature = registry.getJobFeature(jobName);
    if (callerFeature === undefined) {
      throw new InternalError({
        message: `Job ${jobName}: ctx.events.append needs an owning feature, none is registered for this job`,
      });
    }
    await runInOwnTransaction(jobDb, (txDb) =>
      appendDomainEventCore(
        {
          registry,
          db: tenantDbWriteRunner(txDb, CALL_SITE_LABEL),
          tenantId,
          userId: String(systemUser.id),
          callSiteLabel: CALL_SITE_LABEL,
          callerFeature,
        },
        args,
      ),
    );
  });
}
